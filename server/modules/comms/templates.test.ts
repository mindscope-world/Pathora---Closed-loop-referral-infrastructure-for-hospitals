import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TemplateDto } from '../../../shared/types';
import { prisma } from '../../test/helpers';
import { DISCREET, app, approvedTemplate, as, makeWorkspace, type Actor, type Workspace } from '../../test/workspace';

let ws: Workspace;
beforeAll(async () => {
  ws = await makeWorkspace();
});
afterAll(() => prisma.$disconnect());

const draft = (over: object = {}, actor: Actor = ws.manager) =>
  request(app).post('/api/templates').set(as(actor)).send({ name: `T ${Math.random().toString(36).slice(2, 8)}`, pathway: null, channel: 'SMS', language: 'ENGLISH', body: DISCREET, ...over });
const patch = (id: string, body: object, actor: Actor = ws.manager) => request(app).patch(`/api/templates/${id}`).set(as(actor)).send(body);
const approve = (id: string, actor: Actor = ws.clinical) => request(app).post(`/api/templates/${id}/approve`).set(as(actor));
const events = async (id: string) => (await prisma.auditEvent.findMany({ where: { orgId: ws.orgId, resourceId: id }, orderBy: { id: 'asc' } })).map((e) => e.action);

describe('drafting', () => {
  it('creates a DRAFT that cannot be sent until approved, and audits it', async () => {
    const res = await draft({ name: 'Follow-up reminder', pathway: 'NCD_SCREENING', language: 'KISWAHILI' }).expect(201);
    expect(res.body).toMatchObject({
      name: 'Follow-up reminder', pathway: 'NCD_SCREENING', channel: 'SMS', language: 'KISWAHILI', status: 'DRAFT', approvedBy: null, approvedAt: null,
      reviewedBy: 'Awaiting clinical approval', placeholders: ['facility', 'phone'],
    });
    expect(await events(res.body.id)).toEqual(['TEMPLATE_CREATED']);
  });

  it.each([
    ['clinical wording', { body: 'Your cancer screening result is ready at {facility}' }, /cancer/],
    ['a link', { body: 'See https://example.org for details at {facility}' }, /links/],
    ['an unknown placeholder', { body: 'Hello {name}, visit {facility} soon' }, /Unknown placeholder \{name\}/],
    ['too long', { body: 'x'.repeat(321) }, /320 characters/],
  ])('refuses wording with %s, saying exactly what to fix', async (_l, over, msg) => {
    const res = await draft(over);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ path: 'body' });
    expect(res.body.error.details.map((d: { message: string }) => d.message).join(' ')).toMatch(msg);
  });

  it.each([
    ['no name', { name: '' }], ['bad channel', { channel: 'FAX' }], ['bad language', { language: 'FRENCH' }], ['bad pathway', { pathway: 'DENTAL' }], ['empty body', { body: '' }], ['name with newline', { name: 'a\nb' }],
  ])('validates %s', async (_l, over) => expect((await draft(over)).status).toBe(400));

  it('names must be unique within the organisation (but may repeat across organisations)', async () => {
    await draft({ name: 'Unique reminder' }).expect(201);
    const dup = await draft({ name: 'Unique reminder' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('TEMPLATE_EXISTS');
    expect((await draft({ name: 'Unique reminder' }, (await makeWorkspace()).manager)).status).toBe(201);
  });

  it('staff (manager, coordinator) can draft; nobody else can', async () => {
    for (const a of [ws.manager, ws.coordinator]) expect((await draft({}, a)).status, a.name).toBe(201);
    for (const a of [ws.clinical, ws.dpo, ws.focalA]) expect((await draft({}, a)).status, a.name).toBe(403);
    expect((await request(app).post('/api/templates').send({})).status).toBe(401);
  });
});

describe('approval: staff draft, the clinical lead approves', () => {
  it('only the Partner Clinical Lead can approve, and the approver is recorded', async () => {
    const t = (await draft().expect(201)).body as TemplateDto;
    for (const a of [ws.manager, ws.coordinator, ws.dpo, ws.focalA]) expect((await approve(t.id, a)).status, a.name).toBe(403);
    const ok = (await approve(t.id).expect(200)).body as TemplateDto;
    expect(ok).toMatchObject({ status: 'APPROVED', approvedBy: 'Clara Clinical', reviewedBy: 'Clara Clinical · Partner Clinical Lead' });
    expect(Date.parse(ok.approvedAt!)).toBeGreaterThan(Date.now() - 60_000);
    expect(await events(t.id)).toEqual(['TEMPLATE_CREATED', 'TEMPLATE_APPROVED']);
  });

  it('approving twice changes nothing and writes no second audit entry', async () => {
    const t = (await draft().expect(201)).body as TemplateDto;
    const first = (await approve(t.id).expect(200)).body as TemplateDto;
    const second = (await approve(t.id).expect(200)).body as TemplateDto;
    expect(second.approvedAt).toBe(first.approvedAt);
    expect((await events(t.id)).filter((a) => a === 'TEMPLATE_APPROVED')).toHaveLength(1);
  });

  it('re-checks the wording at approval, so a template whose text was corrupted directly cannot be approved', async () => {
    const t = (await draft().expect(201)).body as TemplateDto;
    await prisma.messageTemplate.update({ where: { id: t.id }, data: { body: 'Your HIV result is ready' } });
    const res = await approve(t.id);
    expect(res.status).toBe(400);
    expect((await prisma.messageTemplate.findUniqueOrThrow({ where: { id: t.id } })).approvedAt).toBeNull();
  });

  it('editing the wording of an approved template withdraws its approval', async () => {
    const t = await approvedTemplate(ws);
    const edited = (await patch(t.id, { body: 'Hello, please visit {facility} when you can. Call {phone} if you need help.' }).expect(200)).body as TemplateDto;
    expect(edited).toMatchObject({ status: 'DRAFT', approvedBy: null, approvedAt: null, reviewedBy: 'Awaiting clinical approval' });
    const ev = (await prisma.auditEvent.findMany({ where: { orgId: ws.orgId, resourceId: t.id, action: 'TEMPLATE_UPDATED' } }))[0];
    expect(ev.detail).toContain('approval was withdrawn');
    expect((await approve(t.id).expect(200)).body.status).toBe('APPROVED'); // and it can be approved again
  });

  it('a no-op edit leaves an approved template approved', async () => {
    const t = await approvedTemplate(ws);
    const same = (await patch(t.id, { body: t.body, name: t.name }).expect(200)).body as TemplateDto;
    expect(same.status).toBe('APPROVED');
  });

  it('editing validates the new wording the same way', async () => {
    const t = (await draft().expect(201)).body as TemplateDto;
    expect((await patch(t.id, { body: 'Your biopsy is booked' })).status).toBe(400);
    expect((await patch(t.id, {})).status).toBe(400);
    expect((await patch(t.id, { name: 'Only a rename' }).expect(200)).body.name).toBe('Only a rename');
  });
});

describe('retiring', () => {
  it('retired templates stay in the list as RETIRED, cannot be edited or approved, and retiring is idempotent', async () => {
    const t = await approvedTemplate(ws);
    const gone = (await request(app).post(`/api/templates/${t.id}/retire`).set(as(ws.manager)).expect(200)).body as TemplateDto;
    expect(gone.status).toBe('RETIRED');
    await request(app).post(`/api/templates/${t.id}/retire`).set(as(ws.manager)).expect(200);
    expect(await events(t.id)).toEqual(['TEMPLATE_CREATED', 'TEMPLATE_APPROVED', 'TEMPLATE_RETIRED']);
    const edit = await patch(t.id, { name: 'Renamed' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('TEMPLATE_RETIRED');
    expect((await approve(t.id)).status).toBe(409);
    expect(((await request(app).get('/api/templates').set(as(ws.manager)).expect(200)).body.templates as TemplateDto[]).find((x) => x.id === t.id)!.status).toBe('RETIRED');
  });
});

describe('listing and isolation', () => {
  it('lists templates for the roles that may see patient communications', async () => {
    for (const a of [ws.manager, ws.coordinator, ws.clinical, ws.dpo]) expect((await request(app).get('/api/templates').set(as(a))).status, a.name).toBe(200);
    expect((await request(app).get('/api/templates').set(as(ws.focalA))).status).toBe(403);
    expect((await request(app).get('/api/templates')).status).toBe(401);
  });

  it('active templates come before retired ones, and each shows who approved it', async () => {
    const w = await makeWorkspace();
    const a = await approvedTemplate(w, { name: 'AAA active' });
    const r = await approvedTemplate(w, { name: 'BBB retired' });
    await request(app).post(`/api/templates/${r.id}/retire`).set(as(w.manager)).expect(200);
    const list = (await request(app).get('/api/templates').set(as(w.manager)).expect(200)).body.templates as TemplateDto[];
    expect(list.map((t) => t.name)).toEqual(['AAA active', 'BBB retired']);
    expect(list[0]).toMatchObject({ id: a.id, approvedBy: 'Clara Clinical' });
  });

  it('are private to the organisation, including by id', async () => {
    const mine = (await draft().expect(201)).body as TemplateDto;
    const other = await makeWorkspace();
    expect(((await request(app).get('/api/templates').set(as(other.manager)).expect(200)).body.templates as TemplateDto[]).map((t) => t.id)).not.toContain(mine.id);
    expect((await patch(mine.id, { name: 'Hijacked' }, other.manager)).status).toBe(404);
    expect((await approve(mine.id, other.clinical)).status).toBe(404);
    expect((await request(app).post(`/api/templates/${mine.id}/retire`).set(as(other.manager))).status).toBe(404);
    expect((await patch('nope', { name: 'A valid name' })).status).toBe(404);
  });
});

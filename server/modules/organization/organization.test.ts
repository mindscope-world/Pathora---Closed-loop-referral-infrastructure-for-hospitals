import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrganizationDto } from '../../../shared/types';
import { prisma } from '../../test/helpers';
import { app, as, makeWorkspace, type Actor, type Workspace } from '../../test/workspace';
import { verifyAuditChain } from '../audit/append';

let ws: Workspace;
beforeAll(async () => {
  ws = await makeWorkspace();
});
afterAll(() => prisma.$disconnect());

const get = (actor: Actor = ws.manager) => request(app).get('/api/organization').set(as(actor));
const patch = (body: object, actor: Actor = ws.manager, w: Workspace = ws) => request(app).patch('/api/organization').set(as(actor)).send(body);
const orgEvents = async (w = ws) => (await prisma.auditEvent.findMany({ where: { orgId: w.orgId, action: 'ORG_SETTINGS_UPDATED' }, orderBy: { id: 'asc' } }));

describe('GET /api/organization', () => {
  it('returns the organisation’s settings to every role', async () => {
    for (const a of [ws.manager, ws.coordinator, ws.focalA, ws.clinical, ws.dpo]) {
      const res = await get(a).expect(200);
      expect(res.body).toMatchObject({ id: ws.orgId, retentionDays: 365, dpoContact: null });
      expect(res.body.name).toMatch(/^Test Org/);
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect((await request(app).get('/api/organization')).status).toBe(401);
  });
});

describe('PATCH /api/organization', () => {
  it('updates the settings, returns them, and audits exactly what changed', async () => {
    const res = await patch({ name: 'Nairobi Preventive Screening Network', dpoContact: 'David Kamau (dpo@partner.example)', retentionDays: 730 }).expect(200);
    expect(res.body).toMatchObject({ name: 'Nairobi Preventive Screening Network', dpoContact: 'David Kamau (dpo@partner.example)', retentionDays: 730 });
    expect(await get(ws.dpo).then((r) => r.body)).toMatchObject({ retentionDays: 730 }); // persisted, visible to others

    const [ev] = (await orgEvents()).slice(-1);
    expect(ev).toMatchObject({ actorId: ws.manager.id, resourceType: 'Organization', resourceId: ws.orgId });
    expect(ev.detail).toContain('Retention window (days): 365 → 730');
    expect(ev.detail).toContain('Organisation name: ');
    expect(ev.detail).toContain('Data protection contact: null → "David Kamau (dpo@partner.example)"');
    expect(await verifyAuditChain(prisma, ws.orgId)).toMatchObject({ ok: true });
  });

  it('changes only the fields sent', async () => {
    const before = (await get().expect(200)).body as OrganizationDto;
    const after = (await patch({ retentionDays: 400 }).expect(200)).body as OrganizationDto;
    expect(after).toEqual({ ...before, retentionDays: 400 });
  });

  it('turns an empty contact into "none"', async () => {
    await patch({ dpoContact: 'Someone (s@example.org)' }).expect(200);
    expect((await patch({ dpoContact: '   ' }).expect(200)).body.dpoContact).toBeNull();
    expect((await patch({ dpoContact: 'Someone Else' }).expect(200)).body.dpoContact).toBe('Someone Else');
    expect((await patch({ dpoContact: null }).expect(200)).body.dpoContact).toBeNull();
  });

  it('a no-op writes no audit entry', async () => {
    const current = (await get().expect(200)).body as OrganizationDto;
    const before = (await orgEvents()).length;
    await patch({ name: current.name, retentionDays: current.retentionDays }).expect(200);
    expect((await orgEvents()).length).toBe(before);
  });

  it.each([
    ['empty body', {}],
    ['nothing recognised', { colour: 'red' }],
    ['name too short', { name: 'A' }],
    ['name with a line break', { name: 'Evil\nOrg' }],
    ['retention below the minimum', { retentionDays: 29 }],
    ['retention above the maximum', { retentionDays: 3651 }],
    ['fractional retention', { retentionDays: 365.5 }],
    ['text retention', { retentionDays: '365' }],
    ['contact too long', { dpoContact: 'x'.repeat(201) }],
    ['contact with a line break', { dpoContact: 'a\nb' }],
  ])('rejects %s', async (_l, body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts the boundary values', async () => {
    expect((await patch({ retentionDays: 30 }).expect(200)).body.retentionDays).toBe(30);
    expect((await patch({ retentionDays: 3650 }).expect(200)).body.retentionDays).toBe(3650);
    await patch({ retentionDays: 365 }).expect(200);
  });

  it('is limited to the Programme Manager', async () => {
    for (const a of [ws.coordinator, ws.focalA, ws.clinical, ws.dpo]) expect((await patch({ name: 'Hijacked Org' }, a)).status, a.name).toBe(403);
    expect((await request(app).patch('/api/organization').send({ name: 'Nope' })).status).toBe(401);
    expect(((await get().expect(200)).body as OrganizationDto).name).not.toBe('Hijacked Org');
  });

  it('only ever touches the caller’s own organisation', async () => {
    const other = await makeWorkspace();
    const otherBefore = (await get(other.manager).expect(200)).body as OrganizationDto;
    await patch({ name: 'Mine Only Name' }).expect(200);
    expect((await get(other.manager).expect(200)).body).toEqual(otherBefore);
    // an id in the body is simply ignored
    await request(app).patch('/api/organization').set(as(ws.manager)).send({ id: other.orgId, name: 'Still Mine' }).expect(200);
    expect(((await get(other.manager).expect(200)).body as OrganizationDto).name).toBe(otherBefore.name);
  });

  it('the new name shows up for signed-in users', async () => {
    await patch({ name: 'Renamed Programme' }).expect(200);
    expect((await request(app).get('/api/auth/me').set(as(ws.coordinator)).expect(200)).body.user.organization.name).toBe('Renamed Programme');
  });
});

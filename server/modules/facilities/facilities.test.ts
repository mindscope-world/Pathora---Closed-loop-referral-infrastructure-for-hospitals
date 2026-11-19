import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FacilityDto, FacilityInput } from '../../../shared/types';
import { prisma } from '../../test/helpers';
import { act, app, as, caseBody, createCase, makeWorkspace, type Actor, type Workspace } from '../../test/workspace';

let ws: Workspace;
beforeAll(async () => {
  ws = await makeWorkspace();
});
afterAll(() => prisma.$disconnect());

const input = (over: Partial<FacilityInput> = {}): FacilityInput => ({ name: `Test Clinic ${Math.random().toString(36).slice(2, 8)}`, type: 'FAITH_BASED', city: 'Nakuru', interopMethod: 'PORTAL_CSV', ...over });
const post = (body: object, actor: Actor = ws.manager) => request(app).post('/api/facilities').set(as(actor)).send(body);
const patch = (id: string, body: object, actor: Actor = ws.manager) => request(app).patch(`/api/facilities/${id}`).set(as(actor)).send(body);
const list = async (actor: Actor = ws.manager) => (await request(app).get('/api/facilities').set(as(actor)).expect(200)).body.facilities as FacilityDto[];
const events = async (id: string) => (await prisma.auditEvent.findMany({ where: { orgId: ws.orgId, resourceId: id }, orderBy: { id: 'asc' } }));

describe('creating facilities', () => {
  it('adds a receiving facility, returns it ready to use, and audits it', async () => {
    const body = input({ name: 'Rift Valley Mission Hospital', city: 'Eldoret', type: 'FAITH_BASED', interopMethod: 'STATUS_RETURN_DESK' });
    const res = await post(body).expect(201);
    expect(res.body).toEqual({ id: expect.any(String), ...body, focalPerson: null, avgAckHours: null });
    expect((await list()).map((f) => f.name)).toContain(body.name);
    const [ev] = await events(res.body.id);
    expect(ev).toMatchObject({ action: 'FACILITY_CREATED', actorId: ws.manager.id, resourceType: 'Facility' });
    expect(ev.detail).toBe('Added receiving facility "Rift Valley Mission Hospital" (Eldoret).');
  });

  it('can immediately receive referrals and a focal contact', async () => {
    const f = (await post(input()).expect(201)).body as FacilityDto;
    const c = await createCase(ws, { facilityId: f.id });
    expect(c.facility.id).toBe(f.id);
    const invited = await request(app).post('/api/users/invite').set(as(ws.manager)).send({ email: `focal.${Date.now()}@test.example`, name: 'New Focal', role: 'FACILITY_FOCAL', facilityId: f.id });
    expect(invited.status).toBe(201);
    void caseBody; void act;
  });

  it('refuses a duplicate name within the organisation, but allows the same name in another one', async () => {
    const body = input({ name: 'Unique Name Hospital' });
    await post(body).expect(201);
    const dup = await post(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('FACILITY_EXISTS');
    const other = await makeWorkspace();
    expect((await post(body, other.manager)).status).toBe(201);
  });

  it.each([
    ['missing name', { name: undefined }],
    ['name too short', { name: 'A' }],
    ['name with a line break', { name: 'Bad\nName' }],
    ['unknown type', { type: 'SPACESHIP' }],
    ['unknown interop method', { interopMethod: 'CARRIER_PIGEON' }],
    ['missing city', { city: '' }],
  ])('rejects %s', async (_l, over) => {
    const res = await post({ ...input(), ...over });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('is limited to the Programme Manager', async () => {
    for (const a of [ws.coordinator, ws.focalA, ws.clinical, ws.dpo]) expect((await post(input(), a)).status, a.name).toBe(403);
    expect((await request(app).post('/api/facilities').send(input())).status).toBe(401);
  });

  it('a new facility belongs only to the creating organisation', async () => {
    const f = (await post(input()).expect(201)).body as FacilityDto;
    const other = await makeWorkspace();
    expect((await list(other.manager)).map((x) => x.id)).not.toContain(f.id);
  });
});

describe('updating facilities', () => {
  it('changes only the fields sent, and audits the before → after', async () => {
    const f = (await post(input({ name: 'Old Name Clinic', city: 'Kisii' })).expect(201)).body as FacilityDto;
    const res = await patch(f.id, { name: 'New Name Clinic', interopMethod: 'API_READY' }).expect(200);
    expect(res.body).toMatchObject({ id: f.id, name: 'New Name Clinic', city: 'Kisii', type: f.type, interopMethod: 'API_READY' });
    const ev = (await events(f.id)).find((e) => e.action === 'FACILITY_UPDATED')!;
    expect(ev.detail).toBe('Updated Old Name Clinic: name: "Old Name Clinic" → "New Name Clinic"; interopMethod: "PORTAL_CSV" → "API_READY".');
  });

  it('keeps existing referrals attached when a facility is renamed', async () => {
    const f = (await post(input({ name: 'Before Rename' })).expect(201)).body as FacilityDto;
    const c = await createCase(ws, { facilityId: f.id });
    await patch(f.id, { name: 'After Rename' }).expect(200);
    const got = (await request(app).get(`/api/cases/${c.id}`).set(as(ws.manager)).expect(200)).body;
    expect(got.facility).toEqual({ id: f.id, name: 'After Rename' });
  });

  it('a no-op writes no audit entry', async () => {
    const f = (await post(input()).expect(201)).body as FacilityDto;
    await patch(f.id, { name: f.name, city: f.city }).expect(200);
    expect((await events(f.id)).map((e) => e.action)).toEqual(['FACILITY_CREATED']);
  });

  it('refuses to rename onto an existing facility', async () => {
    const a = (await post(input()).expect(201)).body as FacilityDto;
    const b = (await post(input()).expect(201)).body as FacilityDto;
    const res = await patch(b.id, { name: a.name });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FACILITY_EXISTS');
    expect((await list()).find((f) => f.id === b.id)!.name).toBe(b.name);
  });

  it('validates input; an unknown, malformed or other-organisation facility does not exist', async () => {
    const f = (await post(input()).expect(201)).body as FacilityDto;
    const other = await makeWorkspace();
    expect((await patch(f.id, {})).status).toBe(400);
    expect((await patch(f.id, { type: 'NOPE' })).status).toBe(400);
    expect((await patch(f.id, { name: 'x' })).status).toBe(400);
    expect((await patch('nope', { city: 'X' })).status).toBe(404);
    expect((await patch('c'.repeat(25), { city: 'X' })).status).toBe(404);
    expect((await patch(other.facilityA.id, { city: 'Hacked' })).status).toBe(404);
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: other.facilityA.id } })).city).toBe('Nairobi');
  });

  it('is limited to the Programme Manager', async () => {
    const f = (await post(input()).expect(201)).body as FacilityDto;
    for (const a of [ws.coordinator, ws.focalA, ws.clinical, ws.dpo]) expect((await patch(f.id, { city: 'Nope' }, a)).status, a.name).toBe(403);
  });
});

describe('reading facilities', () => {
  it('shows the focal contact and measured acknowledgment time, as before', async () => {
    const f = (await post(input()).expect(201)).body as FacilityDto;
    expect(f).toMatchObject({ focalPerson: null, avgAckHours: null });
    const found = (await list()).find((x) => x.id === ws.facilityA.id)!;
    expect(found.focalPerson).toBe('Fiona Focal');
  });

  it('every role can list; a facility focal sees only their own', async () => {
    for (const a of [ws.manager, ws.coordinator, ws.clinical, ws.dpo]) expect((await list(a)).length).toBeGreaterThanOrEqual(2);
    expect((await list(ws.focalA)).map((f) => f.id)).toEqual([ws.facilityA.id]);
    expect((await request(app).get('/api/facilities')).status).toBe(401);
  });
});

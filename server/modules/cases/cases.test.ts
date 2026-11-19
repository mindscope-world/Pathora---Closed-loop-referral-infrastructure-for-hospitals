import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CaseDto, CaseListResponse } from '../../../shared/types';
import { decryptField, aad } from '../../lib/crypto';
import { yearInNairobi } from '../../lib/time';
import { prisma } from '../../test/helpers';
import { act, advance, app, as, caseBody, createCase, makeWorkspace, type Workspace } from '../../test/workspace';
import { verifyAuditChain } from '../audit/append';
import { deriveStatus } from './sla';

const H = 3_600_000;
let ws: Workspace;
beforeAll(async () => {
  ws = await makeWorkspace();
});
afterAll(() => prisma.$disconnect());

/** Puts a case's SLA deadline `hoursAgo` in the past. issuedAt moves back too: the DB forbids a deadline before issue. */
const expire = (ref: string, hoursAgo: number, orgId = ws.orgId) =>
  prisma.referralCase.updateMany({
    where: { orgId, refNumber: ref },
    data: { issuedAt: new Date(Date.now() - (hoursAgo + 24) * H), slaDueAt: new Date(Date.now() - hoursAgo * H) },
  });

const get = (path: string, actor = ws.manager) => request(app).get(`/api/cases${path}`).set(as(actor));
const auditActions = async (ref: string) =>
  (await prisma.auditEvent.findMany({ where: { orgId: ws.orgId, resourceId: ref }, orderBy: { id: 'asc' } })).map((e) => e.action);

describe('create', () => {
  it('creates a tracked case with SLA, milestone, encrypted patient, consent and audit', async () => {
    const before = Date.now();
    const res = await request(app).post('/api/cases').set(as(ws.coordinator)).send(caseBody(ws, { patientLabel: 'Cohort NBO · F / 44', redFlag: true }));
    expect(res.status).toBe(201);
    const c: CaseDto = res.body;

    expect(c.id).toBe(`REF-${yearInNairobi()}-${c.id.split('-')[2]}`);
    expect(c.id).toMatch(/^REF-\d{4}-\d{4,}$/);
    expect(c).toMatchObject({
      patientName: 'Wanjiru Kamau', patientLabel: 'Cohort NBO · F / 44', pathway: 'CANCER_SCREENING', stage: 'HANDOFF_SENT',
      status: 'AWAITING_ACK', redFlag: true, consentSms: true, consentWhatsApp: false, optedOut: false, version: 1,
      coordinator: { id: ws.coordinator.id }, facility: { id: ws.facilityA.id }, closureReason: null, outcomeSource: null,
    });
    expect(c.patientCode).toMatch(/^PT-\d+$/);
    expect(Object.keys(c.milestones)).toEqual(['referralIssuedAt']);

    // Default cancer pack: 24h ack SLA, 7-day evaluation target.
    const issued = Date.parse(c.milestones.referralIssuedAt!);
    expect(issued).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(c.slaDueAt!) - issued).toBe(24 * H);
    expect(Date.parse(c.dueDate) - issued).toBe(7 * 24 * H);
    expect(c.slaHoursRemaining).toBeGreaterThanOrEqual(23);

    // Stored encrypted, indexed by blind tokens, never in plaintext.
    const patient = await prisma.patient.findFirstOrThrow({ where: { orgId: ws.orgId, patientCode: c.patientCode } });
    expect(Buffer.from(patient.nameEnc).includes(Buffer.from('Wanjiru'))).toBe(false);
    expect(decryptField(patient.nameEnc, aad.patientName(ws.orgId))).toBe('Wanjiru Kamau');
    expect(patient.nameTokens).toHaveLength(2);
    expect(JSON.stringify(patient.nameTokens)).not.toMatch(/wanjiru/i);

    // Audit: one event, attributed to the caller, with the code but NOT the patient's name.
    const events = await prisma.auditEvent.findMany({ where: { orgId: ws.orgId, resourceId: c.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'CASE_CREATED', actorId: ws.coordinator.id, actorLabel: 'Cora Coordinator' });
    expect(events[0].detail).toContain(c.patientCode);
    expect(events[0].detail).not.toMatch(/Wanjiru|Kamau/);
    expect(await verifyAuditChain(prisma, ws.orgId)).toMatchObject({ ok: true });
  });

  it('issues unique, sequential reference numbers and patient codes under concurrency', async () => {
    const created = await Promise.all(Array.from({ length: 8 }, () => createCase(ws)));
    expect(new Set(created.map((c) => c.id)).size).toBe(8);
    expect(new Set(created.map((c) => c.patientCode)).size).toBe(8);
  });

  it('keeps the SLA of the rule-pack version in force (NCD = 48h)', async () => {
    const c = await createCase(ws, { pathway: 'NCD_SCREENING' });
    expect(Date.parse(c.slaDueAt!) - Date.parse(c.milestones.referralIssuedAt!)).toBe(48 * H);
  });

  it('records no SMS consent when none was given', async () => {
    expect(await createCase(ws, { consentSms: false })).toMatchObject({ consentSms: false, optedOut: false });
  });

  it.each([
    ['no name and no code', { patientName: undefined }, 400, 'VALIDATION_ERROR'],
    ['bad patient code', { patientCode: 'bad code!' }, 400, 'VALIDATION_ERROR'],
    ['bad pathway', { pathway: 'NOPE' as never }, 400, 'VALIDATION_ERROR'],
    ['unknown facility', { facilityId: 'nope' }, 422, 'INVALID_REFERENCE'],
    ['unknown owner', { coordinatorId: 'nope' }, 422, 'INVALID_REFERENCE'],
    ['pathway not yet available', { pathway: 'MATERNAL_CHILD_HEALTH' as const }, 422, 'PATHWAY_UNAVAILABLE'],
  ])('rejects %s', async (_l, over, status, code) => {
    const res = await request(app).post('/api/cases').set(as(ws.coordinator)).send({ ...caseBody(ws), ...over });
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
  });

  it('refuses a facility focal, DPO and clinical lead; and anonymous callers', async () => {
    for (const actor of [ws.focalA, ws.dpo, ws.clinical]) {
      expect((await request(app).post('/api/cases').set(as(actor)).send(caseBody(ws))).status).toBe(403);
    }
    expect((await request(app).post('/api/cases').send(caseBody(ws))).status).toBe(401);
  });

  it('refuses an owner who is a facility focal, or inactive', async () => {
    expect((await request(app).post('/api/cases').set(as(ws.manager)).send(caseBody(ws, { coordinatorId: ws.focalA.id }))).status).toBe(422);
    await prisma.user.update({ where: { id: ws.coordinator2.id }, data: { active: false } });
    expect((await request(app).post('/api/cases').set(as(ws.manager)).send(caseBody(ws, { coordinatorId: ws.coordinator2.id }))).status).toBe(422);
    await prisma.user.update({ where: { id: ws.coordinator2.id }, data: { active: true } });
  });

  it('blocks a second OPEN referral for the same patient and pathway, but allows another pathway', async () => {
    const first = await createCase(ws, { patientCode: 'PT-DUP1' });
    const dup = await request(app).post('/api/cases').set(as(ws.coordinator)).send(caseBody(ws, { patientCode: 'PT-DUP1' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_REFERRAL');
    expect(dup.body.error.message).toContain(first.id);
    const other = await createCase(ws, { patientCode: 'pt-dup1', pathway: 'NCD_SCREENING' }); // code is case-insensitive
    expect(other.patientCode).toBe('PT-DUP1');
    // ...and the patient record is shared, not duplicated
    expect(await prisma.patient.count({ where: { orgId: ws.orgId, patientCode: 'PT-DUP1' } })).toBe(1);
  });

  it('allows a new referral once the earlier one is closed', async () => {
    const first = await createCase(ws, { patientCode: 'PT-REUSE' });
    await advance(ws, first.id, 'closed');
    expect((await createCase(ws, { patientCode: 'PT-REUSE' })).id).not.toBe(first.id);
  });
});

describe('idempotency', () => {
  const post = (key: string | undefined, body = caseBody(ws, { patientCode: undefined })) => {
    const r = request(app).post('/api/cases').set(as(ws.coordinator));
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };

  it('a retried request returns the original case instead of creating a duplicate', async () => {
    const body = caseBody(ws, { patientName: 'Idem Potent' });
    const first = await post('key-aaaaaaaa-1', body);
    const second = await post('key-aaaaaaaa-1', body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const all = (await get('?q=Potent')).body as CaseListResponse;
    expect(all.cases.filter((c) => c.patientName === 'Idem Potent')).toHaveLength(1);
  });

  it('rejects the same key with a different body', async () => {
    await post('key-bbbbbbbb-2', caseBody(ws, { patientName: 'One' })).expect(201);
    const res = await post('key-bbbbbbbb-2', caseBody(ws, { patientName: 'Two' }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('concurrent requests with one key create exactly one case', async () => {
    const body = caseBody(ws, { patientName: 'Concurrent Key' });
    const results = await Promise.all(Array.from({ length: 5 }, () => post('key-cccccccc-3', body)));
    const ok = results.filter((r) => r.status === 201);
    const refs = new Set(ok.map((r) => r.body.id));
    expect(refs.size).toBe(1);
    for (const r of results) expect([201, 409]).toContain(r.status);
    expect(((await get('?q=Concurrent')).body as CaseListResponse).cases.filter((c) => c.patientName === 'Concurrent Key')).toHaveLength(1);
  });

  it('releases the key when the first attempt fails, so a corrected retry works', async () => {
    const bad = await post('key-dddddddd-4', caseBody(ws, { facilityId: 'nope' }));
    expect(bad.status).toBe(422);
    // same key, now valid (different body): allowed because the failed attempt did not keep the key
    expect((await post('key-dddddddd-4', caseBody(ws, { patientName: 'Fixed Retry' }))).status).toBe(201);
  });

  it('keys are per user, and malformed keys are rejected', async () => {
    const body = caseBody(ws, { patientName: 'Per User' });
    const a = await request(app).post('/api/cases').set(as(ws.coordinator)).set('Idempotency-Key', 'key-eeeeeeee-5').send(body);
    const b = await request(app).post('/api/cases').set(as(ws.manager)).set('Idempotency-Key', 'key-eeeeeeee-5').send(body);
    expect(a.body.id).not.toBe(b.body.id);
    expect((await post('short')).status).toBe(400);
  });

  it('is optional: no key, no deduplication', async () => {
    const a = await post(undefined, caseBody(ws, { patientName: 'No Key' }));
    const b = await post(undefined, caseBody(ws, { patientName: 'No Key' }));
    expect(a.body.id).not.toBe(b.body.id);
  });
});

describe('lifecycle', () => {
  it('acknowledge → attendance → close, with milestones, SLA resets, attribution and a complete audit trail', async () => {
    const created = await createCase(ws);

    const acked = (await act(ws.focalA, created.id, 'acknowledge').expect(200)).body as CaseDto;
    expect(acked).toMatchObject({ stage: 'ACKNOWLEDGED', status: 'ACTIVE', version: 2 });
    expect(acked.milestones.facilityAcknowledgedAt).toBeTruthy();
    // After acknowledgment the clock is the evaluation target (7 days from issue), not the ack SLA.
    expect(Date.parse(acked.slaDueAt!) - Date.parse(acked.milestones.referralIssuedAt!)).toBe(7 * 24 * H);

    const attended = (await act(ws.focalA, created.id, 'attendance').expect(200)).body as CaseDto;
    expect(attended).toMatchObject({ stage: 'ATTENDED', status: 'ACTIVE', version: 3 });

    const closed = (await act(ws.focalA, created.id, 'close', { closureReason: 'Biopsy negative · routine screening' }).expect(200)).body as CaseDto;
    expect(closed).toMatchObject({
      stage: 'CLOSED', status: 'CLOSED_VERIFIED', slaHoursRemaining: 0, slaDueAt: null, version: 4,
      closureReason: 'Biopsy negative · routine screening',
      outcomeSource: `Fiona Focal (${ws.facilityA.name})`, // attributed to the real person by default
    });
    expect(Object.keys(closed.milestones).sort()).toEqual(
      ['evaluationCompletedAt', 'facilityAcknowledgedAt', 'outcomeDocumentedAt', 'patientAttendedAt', 'referralIssuedAt']);

    expect(await auditActions(created.id)).toEqual(['CASE_CREATED', 'FACILITY_ACKNOWLEDGED', 'ATTENDANCE_CONFIRMED', 'OUTCOME_VERIFIED_CLOSURE']);
    const events = await prisma.auditEvent.findMany({ where: { orgId: ws.orgId, resourceId: created.id }, orderBy: { id: 'asc' } });
    expect(events.slice(1).every((e) => e.actorId === ws.focalA.id)).toBe(true);
    expect(await verifyAuditChain(prisma, ws.orgId)).toMatchObject({ ok: true });
  });

  it('accepts an explicit outcome source', async () => {
    const c = await createCase(ws);
    await advance(ws, c.id, 'attended');
    const closed = (await act(ws.focalA, c.id, 'close', { closureReason: 'Care plan documented', outcomeSource: 'Dr. Hassan Bakari' }).expect(200)).body;
    expect(closed.outcomeSource).toBe('Dr. Hassan Bakari');
  });

  it('rejects skipped steps with 409 and leaves the case untouched (no fabricated history)', async () => {
    const c = await createCase(ws);
    const ev0 = (await auditActions(c.id)).length;

    for (const [action, body, msg] of [
      ['attendance', {}, /must acknowledge/],
      ['close', { closureReason: 'Done early' }, /must acknowledge/],
    ] as const) {
      const res = await act(ws.focalA, c.id, action, body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ILLEGAL_TRANSITION');
      expect(res.body.error.message).toMatch(msg);
    }
    await act(ws.focalA, c.id, 'acknowledge').expect(200);
    const early = await act(ws.focalA, c.id, 'close', { closureReason: 'Done early' });
    expect(early.status).toBe(409);
    expect(early.body.error.message).toMatch(/attendance must be confirmed/);
    expect((await act(ws.focalA, c.id, 'acknowledge')).status).toBe(409); // twice

    const now = (await get(`/${c.id}`)).body as CaseDto;
    expect(now.stage).toBe('ACKNOWLEDGED');
    expect(now.version).toBe(2);
    expect(Object.keys(now.milestones).sort()).toEqual(['facilityAcknowledgedAt', 'referralIssuedAt']);
    expect((await auditActions(c.id)).length - ev0).toBe(2); // ack + the CASE_VIEWED from the GET above
  });

  it('a closed case is immutable', async () => {
    const c = await createCase(ws);
    await advance(ws, c.id, 'closed');
    for (const [actor, action, body] of [
      [ws.focalA, 'acknowledge', {}], [ws.focalA, 'attendance', {}], [ws.focalA, 'close', { closureReason: 'again' }],
      [ws.coordinator, 'escalate', { reason: 'late' }], [ws.coordinator, 'barrier-resolution', { note: 'late' }],
      [ws.manager, 'reassign', { coordinatorId: ws.coordinator2.id }],
    ] as const) {
      const res = await act(actor, c.id, action, body);
      expect(res.status, action).toBe(409);
      expect(res.body.error.code).toBe('ILLEGAL_TRANSITION');
    }
  });

  it('validates the action payloads', async () => {
    const c = await createCase(ws);
    expect((await act(ws.coordinator, c.id, 'escalate', {})).status).toBe(400);
    expect((await act(ws.coordinator, c.id, 'escalate', { reason: 'x' })).status).toBe(400);
    expect((await act(ws.coordinator, c.id, 'barrier-resolution', {})).status).toBe(400);
    expect((await act(ws.manager, c.id, 'reassign', {})).status).toBe(400);
    expect((await act(ws.focalA, c.id, 'close', {})).status).toBe(400);
  });
});

describe('who may do what', () => {
  it('only a facility focal can acknowledge / confirm attendance / close', async () => {
    const c = await createCase(ws);
    for (const actor of [ws.manager, ws.coordinator, ws.clinical, ws.dpo]) {
      for (const action of ['acknowledge', 'attendance', 'close']) {
        expect((await act(actor, c.id, action, { closureReason: 'x y z' })).status, `${actor.name} ${action}`).toBe(403);
      }
    }
  });

  it('only manager/coordinator/clinical lead can escalate or log a barrier resolution', async () => {
    const c = await createCase(ws);
    for (const actor of [ws.focalA, ws.dpo]) {
      expect((await act(actor, c.id, 'escalate', { reason: 'slow' })).status).toBe(403);
      expect((await act(actor, c.id, 'barrier-resolution', { note: 'fixed' })).status).toBe(403);
    }
    expect((await act(ws.clinical, c.id, 'escalate', { reason: 'Clinical concern' })).status).toBe(200);
  });

  it('a facility focal cannot see or act on ANOTHER facility’s case — it simply does not exist for them', async () => {
    const c = await createCase(ws); // routed to facility A
    expect((await get(`/${c.id}`, ws.focalB)).status).toBe(404);
    expect((await act(ws.focalB, c.id, 'acknowledge')).status).toBe(404);
    expect((await get(`/${c.id}`, ws.focalA)).status).toBe(200);
    const listB = (await get('?limit=200', ws.focalB)).body as CaseListResponse;
    expect(listB.cases.some((x) => x.id === c.id)).toBe(false);
    expect(listB.cases.every((x) => x.facility.id === ws.facilityB.id)).toBe(true);
    // ...even when the caller asks for the other facility explicitly
    expect(((await get(`?facilityId=${ws.facilityA.id}`, ws.focalB)).body as CaseListResponse).cases).toEqual([]);
  });

  it('a focal can only acknowledge their own facility’s referrals', async () => {
    const c = await createCase(ws, { facilityId: ws.facilityB.id });
    expect((await act(ws.focalA, c.id, 'acknowledge')).status).toBe(404);
    expect((await act(ws.focalB, c.id, 'acknowledge')).status).toBe(200);
  });
});

describe('escalation and barrier resolution', () => {
  it('escalating makes the case overdue and records why; resolving restores real progress and resets the clock', async () => {
    const c = await createCase(ws);
    const esc = (await act(ws.coordinator, c.id, 'escalate', { reason: 'Facility silent for 20h' }).expect(200)).body as CaseDto;
    expect(esc).toMatchObject({ stage: 'ESCALATED', status: 'OVERDUE_SLA', version: 2 });
    expect(esc.notes).toContain('Escalated: Facility silent for 20h');
    expect((await act(ws.coordinator, c.id, 'escalate', { reason: 'again' })).status).toBe(409);

    const before = Date.now();
    const res = (await act(ws.coordinator, c.id, 'barrier-resolution', { note: 'Transport arranged' }).expect(200)).body as CaseDto;
    expect(res).toMatchObject({ stage: 'HANDOFF_SENT', status: 'AWAITING_ACK' }); // not acknowledged yet: back to handoff, not "contacted"
    expect(res.notes).toContain('Resolution logged: Transport arranged');
    expect(res.notes).toContain('Escalated: Facility silent for 20h'); // history is kept
    // fresh window = the pathway's contact SLA (cancer: 12h)
    expect(Date.parse(res.slaDueAt!) - before).toBeGreaterThan(11.9 * H);
    expect(Date.parse(res.slaDueAt!) - before).toBeLessThan(12.1 * H);
    expect(await auditActions(c.id)).toEqual(['CASE_CREATED', 'CASE_ESCALATED', 'BARRIER_RESOLUTION_LOGGED']);
  });

  it('an escalated, acknowledged case returns to ACKNOWLEDGED (never backwards)', async () => {
    const c = await createCase(ws);
    await advance(ws, c.id, 'ack');
    await act(ws.manager, c.id, 'escalate', { reason: 'Patient unreachable' }).expect(200);
    expect(((await act(ws.manager, c.id, 'barrier-resolution', { note: 'Reached by phone' }).expect(200)).body as CaseDto).stage).toBe('ACKNOWLEDGED');
  });

  it('facility progress clears an escalation', async () => {
    const c = await createCase(ws);
    await act(ws.coordinator, c.id, 'escalate', { reason: 'No ack' }).expect(200);
    expect(((await act(ws.focalA, c.id, 'acknowledge').expect(200)).body as CaseDto)).toMatchObject({ stage: 'ACKNOWLEDGED', status: 'ACTIVE' });
  });

  it('an overdue (un-escalated) case recovers its window via barrier resolution', async () => {
    const c = await createCase(ws);
    await expire(c.id, 5);
    expect(((await get(`/${c.id}`)).body as CaseDto).status).toBe('OVERDUE_SLA');
    expect(((await act(ws.coordinator, c.id, 'barrier-resolution', { note: 'Rebooked' }).expect(200)).body as CaseDto).status).toBe('AWAITING_ACK');
  });
});

describe('reassign', () => {
  it('manager transfers ownership and the audit trail names both people', async () => {
    const c = await createCase(ws);
    const res = (await act(ws.manager, c.id, 'reassign', { coordinatorId: ws.coordinator2.id }).expect(200)).body as CaseDto;
    expect(res.coordinator).toEqual({ id: ws.coordinator2.id, name: 'Cal Coordinator' });
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: ws.orgId, resourceId: c.id, action: 'CASE_REASSIGNED' } });
    expect(ev.detail).toBe('Named ownership transferred from Cora Coordinator to Cal Coordinator.');
    expect(ev.actorId).toBe(ws.manager.id);
  });

  it('is a no-op (no version bump, no audit event) when the owner is unchanged', async () => {
    const c = await createCase(ws);
    const res = (await act(ws.manager, c.id, 'reassign', { coordinatorId: ws.coordinator.id }).expect(200)).body as CaseDto;
    expect(res.version).toBe(1);
    expect(await auditActions(c.id)).toEqual(['CASE_CREATED']);
  });

  it('rejects unknown owners and non-managers', async () => {
    const c = await createCase(ws);
    expect((await act(ws.manager, c.id, 'reassign', { coordinatorId: 'nope' })).status).toBe(422);
    expect((await act(ws.manager, c.id, 'reassign', { coordinatorId: ws.focalA.id })).status).toBe(422);
    expect((await act(ws.coordinator, c.id, 'reassign', { coordinatorId: ws.coordinator2.id })).status).toBe(403);
  });
});

describe('concurrency (optimistic locking)', () => {
  it('rejects a change made against a stale view', async () => {
    const c = await createCase(ws);
    await act(ws.coordinator, c.id, 'escalate', { reason: 'first' }).expect(200); // → version 2
    const stale = await act(ws.coordinator, c.id, 'barrier-resolution', { note: 'based on old data', expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(((await get(`/${c.id}`)).body as CaseDto).stage).toBe('ESCALATED'); // unchanged
    expect((await act(ws.coordinator, c.id, 'barrier-resolution', { note: 'Rebooked slot', expectedVersion: 2 })).status).toBe(200);
  });

  it('of two simultaneous identical actions exactly one applies', async () => {
    const c = await createCase(ws);
    const results = await Promise.all([act(ws.focalA, c.id, 'acknowledge'), act(ws.focalA, c.id, 'acknowledge'), act(ws.focalA, c.id, 'acknowledge')]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    const events = (await auditActions(c.id)).filter((a) => a === 'FACILITY_ACKNOWLEDGED');
    expect(events).toHaveLength(1);
    expect(await prisma.caseMilestone.count({ where: { case: { orgId: ws.orgId, refNumber: c.id }, type: 'FACILITY_ACKNOWLEDGED' } })).toBe(1);
  });

  it('conflicting actions never produce an inconsistent case (escalate racing acknowledge)', async () => {
    for (let i = 0; i < 5; i++) {
      const c = await createCase(ws);
      await Promise.all([act(ws.coordinator, c.id, 'escalate', { reason: 'race' }), act(ws.focalA, c.id, 'acknowledge')]);
      const now = (await get(`/${c.id}`)).body as CaseDto;
      const acked = Boolean(now.milestones.facilityAcknowledgedAt);
      // stage must agree with the milestones whichever order won
      if (now.stage === 'ACKNOWLEDGED') expect(acked).toBe(true);
      if (now.stage === 'ESCALATED') expect(typeof acked).toBe('boolean');
      expect(['ACKNOWLEDGED', 'ESCALATED']).toContain(now.stage);
    }
  });
});

describe('reading cases', () => {
  let seeded: CaseDto[];
  let ws2: Workspace;
  beforeAll(async () => {
    ws2 = await makeWorkspace();
    const mk = (over: object) => createCase(ws2, over);
    seeded = [
      await mk({ patientName: 'Amina Wekesa', patientCode: 'PT-A1', pathway: 'CANCER_SCREENING', redFlag: true }),
      await mk({ patientName: 'Brian Otieno', patientCode: 'PT-B1', pathway: 'NCD_SCREENING', facilityId: ws2.facilityB.id, coordinatorId: ws2.coordinator2.id }),
      await mk({ patientName: 'Chebet Korir-Mwangi', patientCode: 'PT-C1', pathway: 'MALE_REPRODUCTIVE_HEALTH' }),
      await mk({ patientName: 'Dennis Mutua', patientCode: 'PT-D1', pathway: 'CANCER_SCREENING', sourceProgram: 'Kisumu Drive' }),
      await mk({ patientName: 'Esther Njoki', patientCode: 'PT-E1', pathway: 'NCD_SCREENING' }),
    ];
  });
  const list = async (qs = '', actor = ws2.manager) => (await request(app).get(`/api/cases${qs}`).set(as(actor)).expect(200)).body as CaseListResponse;
  const ids = (r: CaseListResponse) => r.cases.map((c) => c.id);

  it('lists newest first and sets no-store (patient data must not be cached)', async () => {
    const res = await request(app).get('/api/cases').set(as(ws2.manager));
    expect(res.headers['cache-control']).toBe('no-store');
    expect(ids(res.body)).toEqual(seeded.map((c) => c.id).reverse());
    expect(res.body.nextCursor).toBeNull();
  });

  it('paginates with an opaque cursor, without gaps or repeats', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await list(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...ids(page));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(seeded.map((c) => c.id).reverse());
    expect((await request(app).get('/api/cases?cursor=garbage').set(as(ws2.manager))).status).toBe(400);
    expect((await request(app).get('/api/cases?limit=500').set(as(ws2.manager))).status).toBe(400);
  });

  it('filters by pathway, facility, owner and red flag', async () => {
    expect((await list('?pathway=NCD_SCREENING')).cases.map((c) => c.patientCode).sort()).toEqual(['PT-B1', 'PT-E1']);
    expect((await list(`?facilityId=${ws2.facilityB.id}`)).cases.map((c) => c.patientCode)).toEqual(['PT-B1']);
    expect((await list(`?coordinatorId=${ws2.coordinator2.id}`)).cases.map((c) => c.patientCode)).toEqual(['PT-B1']);
    expect((await list('?redFlag=true')).cases.map((c) => c.patientCode)).toEqual(['PT-A1']);
    expect((await list('?pathway=NCD_SCREENING&redFlag=false')).cases).toHaveLength(2);
    expect((await request(app).get('/api/cases?pathway=BOGUS').set(as(ws2.manager))).status).toBe(400);
  });

  it('searches by reference, patient code, programme, facility, owner and whole-word patient name', async () => {
    const q = async (s: string) => (await list(`?q=${encodeURIComponent(s)}`)).cases.map((c) => c.patientCode).sort();
    expect(await q(seeded[2].id)).toEqual(['PT-C1']);          // full reference
    expect(await q('pt-d')).toEqual(['PT-D1']);                // code, partial, case-insensitive
    expect(await q('kisumu')).toEqual(['PT-D1']);              // source programme
    expect(await q('bravo')).toEqual(['PT-B1']);               // facility name
    expect(await q('cal coordinator')).toEqual(['PT-B1']);     // owner
    expect(await q('Amina')).toEqual(['PT-A1']);               // name word, any case
    expect(await q('WEKESA amina')).toEqual(['PT-A1']);        // every word must match, order-free
    expect(await q('korir')).toEqual(['PT-C1']);               // hyphenated surname
    expect(await q('amina otieno')).toEqual([]);               // words from two different patients
    expect(await q('zzz-nothing')).toEqual([]);
  });

  it('name search is whole-word only (a documented limit of searching encrypted names)', async () => {
    expect(ids(await list('?q=Amin'))).toEqual([]);
    expect(ids(await list('?q=Amina'))).toHaveLength(1);
  });

  it('GET /api/search returns the same matches, capped', async () => {
    const res = await request(app).get('/api/search?q=Brian').set(as(ws2.manager)).expect(200);
    expect(res.body.results.map((c: CaseDto) => c.patientCode)).toEqual(['PT-B1']);
    expect((await request(app).get('/api/search').set(as(ws2.manager))).status).toBe(400);
  });

  it('never returns another organisation’s cases', async () => {
    const other = await makeWorkspace();
    expect((await list('', other.manager)).cases).toEqual([]);
    expect(((await request(app).get('/api/cases?q=Amina').set(as(other.manager))).body as CaseListResponse).cases).toEqual([]);
    expect((await request(app).get(`/api/cases/${seeded[0].id}`).set(as(other.manager))).status).toBe(404);
    for (const [actor, action, body] of [[other.focalA, 'acknowledge', {}], [other.manager, 'escalate', { reason: 'cross tenant' }],
      [other.manager, 'reassign', { coordinatorId: other.coordinator.id }]] as const) {
      expect((await act(actor, seeded[0].id, action, body)).status).toBe(404);
    }
    // and cannot route a new case to this organisation’s facility or owner
    expect((await request(app).post('/api/cases').set(as(other.manager)).send(caseBody(other, { facilityId: ws2.facilityA.id }))).status).toBe(422);
    expect((await request(app).post('/api/cases').set(as(other.manager)).send(caseBody(other, { coordinatorId: ws2.coordinator.id }))).status).toBe(422);
  });

  it('case detail: audited view, timeline for roles that may see it, none for a facility focal', async () => {
    const mgr = (await request(app).get(`/api/cases/${seeded[0].id}`).set(as(ws2.manager)).expect(200)).body;
    expect(mgr.timeline.map((e: { action: string }) => e.action)).toContain('CASE_CREATED');
    expect(mgr.comms).toEqual([]);
    const focal = (await request(app).get(`/api/cases/${seeded[0].id}`).set(as(ws2.focalA)).expect(200)).body;
    expect(focal.timeline).toEqual([]);
    const views = await prisma.auditEvent.findMany({ where: { orgId: ws2.orgId, resourceId: seeded[0].id, action: 'CASE_VIEWED' } });
    expect(views.map((v) => v.actorId).sort()).toEqual([ws2.manager.id, ws2.focalA.id].sort());
    expect(views[0].detail).not.toMatch(/Amina|Wekesa/);
  });

  it('treats malformed or unknown case ids as not found', async () => {
    for (const id of ['nope', 'REF-1-1', 'REF-2026-9999999', '..%2Fetc']) {
      expect((await request(app).get(`/api/cases/${id}`).set(as(ws2.manager))).status, id).toBe(404);
    }
  });
});

describe('status filter agrees with the derived status (SQL ⇄ deriveStatus)', () => {
  it('for every state a case can be in', async () => {
    const w = await makeWorkspace();
    const mk = () => createCase(w);

    const awaiting = await mk();
    const overdueUnacked = await mk();
    await expire(overdueUnacked.id, 2, w.orgId);
    const active = await mk(); await advance(w, active.id, 'ack');
    const overdueAcked = await mk(); await advance(w, overdueAcked.id, 'attended');
    await expire(overdueAcked.id, 1, w.orgId);
    const escalated = await mk(); await act(w.coordinator, escalated.id, 'escalate', { reason: 'no response' });
    const escalatedAcked = await mk(); await advance(w, escalatedAcked.id, 'ack'); await act(w.coordinator, escalatedAcked.id, 'escalate', { reason: 'no response' });
    const closed = await mk(); await advance(w, closed.id, 'closed');
    const justPast = await mk();
    await expire(justPast.id, 1 / 3600, w.orgId);
    const farFuture = await mk(); await advance(w, farFuture.id, 'ack');

    const all = ((await request(app).get('/api/cases?limit=200').set(as(w.manager)).expect(200)).body as CaseListResponse).cases;
    expect(all).toHaveLength(9);
    const byStatus = new Map(all.map((c) => [c.id, c.status]));
    expect(byStatus.get(awaiting.id)).toBe('AWAITING_ACK');
    expect(byStatus.get(overdueUnacked.id)).toBe('OVERDUE_SLA');
    expect(byStatus.get(active.id)).toBe('ACTIVE');
    expect(byStatus.get(overdueAcked.id)).toBe('OVERDUE_SLA');
    expect(byStatus.get(escalated.id)).toBe('OVERDUE_SLA');
    expect(byStatus.get(escalatedAcked.id)).toBe('OVERDUE_SLA');
    expect(byStatus.get(closed.id)).toBe('CLOSED_VERIFIED');
    expect(byStatus.get(justPast.id)).toBe('OVERDUE_SLA');

    for (const status of ['ACTIVE', 'AWAITING_ACK', 'OVERDUE_SLA', 'CLOSED_VERIFIED'] as const) {
      const filtered = ((await request(app).get(`/api/cases?status=${status}&limit=200`).set(as(w.manager)).expect(200)).body as CaseListResponse).cases;
      expect(filtered.map((c) => c.id).sort(), status).toEqual(all.filter((c) => c.status === status).map((c) => c.id).sort());
    }
    // and the pure function agrees with what the API reported
    expect(deriveStatus({ stage: 'HANDOFF_SENT', hasAcknowledged: false, slaDueAt: new Date(Date.now() + H) }, new Date())).toBe('AWAITING_ACK');
  });
});

describe('opt-out (consent)', () => {
  it('DPO records and reverses an opt-out; it is append-only, idempotent and audited', async () => {
    const c = await createCase(ws, { consentSms: true });
    const patientId = (await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId, refNumber: c.id } })).patientId;
    const put = (optedOut: boolean, actor = ws.dpo) => request(app).put(`/api/cases/${c.id}/opt-out`).set(as(actor)).send({ optedOut });

    const out = (await put(true).expect(200)).body as CaseDto;
    expect(out).toMatchObject({ optedOut: true, consentSms: false, consentWhatsApp: false });
    expect(await prisma.consent.count({ where: { patientId } })).toBe(1 + 3); // the original grant + 3 revocations
    await put(true).expect(200); // repeating changes nothing
    expect(await prisma.consent.count({ where: { patientId } })).toBe(4);

    const back = (await put(false).expect(200)).body as CaseDto;
    expect(back).toMatchObject({ optedOut: false, consentSms: true, consentWhatsApp: false });
    await put(false).expect(200);
    expect(await prisma.consent.count({ where: { patientId } })).toBe(5);
    expect(await auditActions(c.id)).toEqual(['CASE_CREATED', 'CONSENT_OPTOUT_RECORDED', 'CONSENT_RESTORED']);

    // and it can flip repeatedly
    expect(((await put(true).expect(200)).body as CaseDto).optedOut).toBe(true);
    expect(((await put(false).expect(200)).body as CaseDto).optedOut).toBe(false);
  });

  it('cannot restore consent that was never given', async () => {
    const c = await createCase(ws, { consentSms: false });
    await request(app).put(`/api/cases/${c.id}/opt-out`).set(as(ws.dpo)).send({ optedOut: true }).expect(200);
    const res = await request(app).put(`/api/cases/${c.id}/opt-out`).set(as(ws.dpo)).send({ optedOut: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_PRIOR_CONSENT');
    expect(((await get(`/${c.id}`)).body as CaseDto).optedOut).toBe(true);
  });

  it('is restricted to the Data Protection Contact', async () => {
    const c = await createCase(ws);
    for (const actor of [ws.manager, ws.coordinator, ws.focalA, ws.clinical]) {
      expect((await request(app).put(`/api/cases/${c.id}/opt-out`).set(as(actor)).send({ optedOut: true })).status).toBe(403);
    }
    expect((await request(app).put(`/api/cases/${c.id}/opt-out`).set(as(ws.dpo)).send({ optedOut: 'yes' })).status).toBe(400);
  });
});

describe('reference data', () => {
  it('lists facilities with a focal person and a computed acknowledgment time', async () => {
    const w = await makeWorkspace();
    const before = (await request(app).get('/api/facilities').set(as(w.manager)).expect(200)).body.facilities as Array<{ id: string; name: string; focalPerson: string | null; avgAckHours: number | null }>;
    const a = before.find((f) => f.id === w.facilityA.id)!;
    expect(a).toMatchObject({ focalPerson: 'Fiona Focal', avgAckHours: null });
    const c = await createCase(w);
    await prisma.caseMilestone.updateMany({ where: { case: { orgId: w.orgId, refNumber: c.id }, type: 'REFERRAL_ISSUED' }, data: { occurredAt: new Date(Date.now() - 10 * H) } });
    await act(w.focalA, c.id, 'acknowledge').expect(200);
    const after = (await request(app).get('/api/facilities').set(as(w.manager))).body.facilities as typeof before;
    expect(after.find((f) => f.id === w.facilityA.id)!.avgAckHours).toBeGreaterThan(9.9);
    expect(after.find((f) => f.id === w.facilityA.id)!.avgAckHours).toBeLessThan(10.2);
  });

  it('a facility focal sees only their own facility', async () => {
    const res = (await request(app).get('/api/facilities').set(as(ws.focalB)).expect(200)).body.facilities;
    expect(res.map((f: { id: string }) => f.id)).toEqual([ws.facilityB.id]);
  });

  it('lists assignable owners: active managers and coordinators only', async () => {
    const res = (await request(app).get('/api/cases/assignees').set(as(ws.manager)).expect(200)).body.assignees as Array<{ name: string; role: string }>;
    expect(res.map((a) => a.name).sort()).toEqual(['Cal Coordinator', 'Cora Coordinator', 'Mona Manager']);
    expect((await request(app).get('/api/cases/assignees').set(as(ws.coordinator))).status).toBe(200);
    for (const a of [ws.focalA, ws.dpo, ws.clinical]) expect((await request(app).get('/api/cases/assignees').set(as(a))).status).toBe(403);
  });
});

describe('CSV import', () => {
  const imp = (csv: string, extra: object = {}, actor = ws.coordinator) =>
    request(app).post('/api/cases/import').set(as(actor)).send({ csv, consentAttested: true, ...extra });
  const row = (code: string, over: Partial<Record<'pathway' | 'owner' | 'facility', string>> = {}) =>
    `${code},Cohort NBO · F / 47,${over.pathway ?? 'Cancer Screening'},Mobile Cervical Screening,${over.owner ?? 'Cora Coordinator'},${over.facility ?? ws.facilityA.name}`;

  it('imports valid rows with consent, per-row audit and one batch audit event', async () => {
    const res = await imp(`${row('IMP-001')}\n${row('IMP-002', { pathway: 'NCD_SCREENING', facility: ws.facilityB.name })}`).expect(201);
    expect(res.body).toMatchObject({ dryRun: false, imported: 2, rejected: 0 });
    const [a, b] = res.body.rows;
    expect(a).toMatchObject({ line: 1, patientCode: 'IMP-001', ok: true });
    const dto = (await get(`/${a.caseId}`)).body as CaseDto;
    expect(dto).toMatchObject({ stage: 'HANDOFF_SENT', status: 'AWAITING_ACK', consentSms: true, patientLabel: 'Cohort NBO · F / 47', sourceProgram: 'Mobile Cervical Screening' });
    expect(dto.patientName).toBe('Patient IMP-001');
    expect(((await get(`/${b.caseId}`)).body as CaseDto).facility.id).toBe(ws.facilityB.id);
    const batch = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: ws.orgId, action: 'CSV_BATCH_IMPORTED' }, orderBy: { id: 'desc' } });
    expect(batch.detail).toBe('Imported 2 consented referrals via secure CSV intake.');
    expect(await auditActions(a.caseId)).toEqual(['CASE_CREATED', 'CASE_VIEWED']);
    expect(await verifyAuditChain(prisma, ws.orgId)).toMatchObject({ ok: true });
  });

  it('reports each bad row with a reason and still imports the good ones', async () => {
    const csv = [
      row('IMP-100'),
      row('bad code!'),
      row('IMP-102', { pathway: 'Dental' }),
      row('IMP-103', { facility: 'Nowhere Hospital' }),
      row('IMP-104', { owner: 'Nobody Known' }),
      row('IMP-105', { pathway: 'Maternal & Child Health' }),
      row('IMP-100'), // duplicate of the first row in this file
      'IMP-107,only,three',
    ].join('\n');
    const res = await imp(csv).expect(201);
    expect(res.body).toMatchObject({ imported: 1, rejected: 7 });
    const errs = Object.fromEntries(res.body.rows.map((r: { line: number; error?: string }) => [r.line, r.error]));
    expect(errs[1]).toBeUndefined();
    expect(errs[2]).toMatch(/Patient code/);
    expect(errs[3]).toMatch(/Unknown pathway "Dental"/);
    expect(errs[4]).toMatch(/Unknown facility "Nowhere Hospital"/);
    expect(errs[5]).toMatch(/Unknown or inactive owner "Nobody Known"/);
    expect(errs[6]).toMatch(/not available for referrals yet/);
    expect(errs[7]).toMatch(/already has an open Cancer Screening referral \(row 1 of this file\)/);
    expect(errs[8]).toMatch(/Unknown pathway/);
  });

  it('a dry run reports exactly what a real import would, and writes nothing', async () => {
    const csv = [row('DRY-1'), row('DRY-2', { facility: 'Nowhere' }), row('DRY-3')].join('\n');
    const cases0 = await prisma.referralCase.count({ where: { orgId: ws.orgId } });
    const audit0 = await prisma.auditEvent.count({ where: { orgId: ws.orgId } });
    const patients0 = await prisma.patient.count({ where: { orgId: ws.orgId } });

    const dry = await imp(csv, { dryRun: true, consentAttested: false }).expect(200); // no attestation needed to validate
    expect(dry.body).toMatchObject({ dryRun: true, imported: 2, rejected: 1 });
    expect(dry.body.rows.every((r: { caseId?: string }) => r.caseId === undefined)).toBe(true);
    expect(await prisma.referralCase.count({ where: { orgId: ws.orgId } })).toBe(cases0);
    expect(await prisma.auditEvent.count({ where: { orgId: ws.orgId } })).toBe(audit0);
    expect(await prisma.patient.count({ where: { orgId: ws.orgId } })).toBe(patients0);

    const real = await imp(csv).expect(201);
    const strip = (rows: Array<{ caseId?: string }>) => rows.map(({ caseId: _c, ...r }) => r);
    expect(strip(real.body.rows)).toEqual(strip(dry.body.rows));
  });

  it('requires the programme to attest consent before importing', async () => {
    const res = await imp(row('ATT-1'), { consentAttested: false });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CONSENT_ATTESTATION_REQUIRED');
    expect((await request(app).post('/api/cases/import').set(as(ws.coordinator)).send({ csv: row('ATT-1') })).status).toBe(422);
    expect(await prisma.patient.count({ where: { orgId: ws.orgId, patientCode: 'ATT-1' } })).toBe(0);
  });

  it('skips a header row, honours quoted fields and an optional patient-name column', async () => {
    const csv = `patientCode,cohortLabel,pathway,sourceProgram,owner,facility,patientName\nQ-1,"Cohort, NBO",cancer_screening,"Drive, Phase 2",Cora Coordinator,${ws.facilityA.name},Quinn Quoted`;
    const res = await imp(csv).expect(201);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].line).toBe(2);
    expect(((await get(`/${res.body.rows[0].caseId}`)).body as CaseDto)).toMatchObject({
      patientName: 'Quinn Quoted', patientLabel: 'Cohort, NBO', sourceProgram: 'Drive, Phase 2',
    });
  });

  it('is atomic: when two imports race on the same new patient, the loser leaves nothing behind', async () => {
    const [x, y] = await Promise.all([
      imp(`${row('RACE-1')}\n${row('RACE-ONLY-X')}`),
      imp(`${row('RACE-1')}\n${row('RACE-ONLY-Y')}`),
    ]);
    const exists = async (code: string) => (await prisma.patient.count({ where: { orgId: ws.orgId, patientCode: code } })) === 1;
    expect(await prisma.patient.count({ where: { orgId: ws.orgId, patientCode: 'RACE-1' } })).toBe(1);

    for (const [res, own] of [[x, 'RACE-ONLY-X'], [y, 'RACE-ONLY-Y']] as const) {
      if (res.status === 409) {
        expect(res.body.error.code).toBe('CONFLICT'); // clean retryable error, not a 500
        expect(await exists(own)).toBe(false);         // nothing from the failed batch was written
      } else {
        expect(res.status).toBe(201);
        expect(await exists(own)).toBe(true);
      }
    }
    // one open Cancer referral for RACE-1, never two
    expect(await prisma.referralCase.count({ where: { orgId: ws.orgId, patient: { patientCode: 'RACE-1' } } })).toBe(1);
    expect(await verifyAuditChain(prisma, ws.orgId)).toMatchObject({ ok: true });
  });

  it('rejects empty, oversized and malformed CSV; and accepts a large body on this route', async () => {
    expect((await imp('   \n  ')).status).toBe(400);
    const tooMany = Array.from({ length: 501 }, (_, i) => row(`M-${i}`)).join('\n');
    const many = await imp(tooMany);
    expect(many.status).toBe(400);
    expect(many.body.error.code).toBe('TOO_MANY_ROWS');
    expect((await imp('a,"unterminated')).body.error.code).toBe('INVALID_CSV');
    // ~150 KB: over the global 100 KB JSON limit, under this route's 1 MB limit
    const label = 'L'.repeat(250);
    const big = Array.from({ length: 500 }, (_, i) => `BIG-${i},${label},Cancer Screening,Src,Cora Coordinator,${ws.facilityA.name}`).join('\n');
    expect(big.length).toBeGreaterThan(100_000);
    const res = await imp(big, { dryRun: true }).expect(200);
    expect(res.body.imported).toBe(500);
    expect((await request(app).post('/api/cases').set(as(ws.coordinator)).send({ pad: 'x'.repeat(150_000) })).status).toBe(413); // other routes keep the 100 KB cap
  });

  it('is restricted to roles that may import, and is idempotent', async () => {
    for (const a of [ws.focalA, ws.dpo, ws.clinical]) expect((await imp(row('NOPE-1'), {}, a)).status).toBe(403);
    const key = 'import-key-0001';
    const send = () => request(app).post('/api/cases/import').set(as(ws.coordinator)).set('Idempotency-Key', key).send({ csv: row('IDEM-IMP'), consentAttested: true });
    const first = await send().expect(201);
    const second = await send().expect(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.patient.count({ where: { orgId: ws.orgId, patientCode: 'IDEM-IMP' } })).toBe(1);
  });
});

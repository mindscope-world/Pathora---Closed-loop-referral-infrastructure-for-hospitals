import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CaseDto, RulePackDto, RulePackListResponse, RulePackVersionDto } from '../../../shared/types';
import { prisma } from '../../test/helpers';
import { act, app, as, caseBody, createCase, makeWorkspace, type Actor, type Workspace } from '../../test/workspace';
import { verifyAuditChain } from '../audit/append';

const H = 3_600_000;
let ws: Workspace;
beforeAll(async () => {
  ws = await makeWorkspace();
});
afterAll(() => prisma.$disconnect());

const list = async (actor: Actor = ws.manager, w: Workspace = ws) => (await request(app).get('/api/rule-packs').set(as(actor)).expect(200)).body as RulePackListResponse;
const pack = async (key: string, w: Workspace = ws, actor: Actor = w.manager) => (await list(actor, w)).rulePacks.find((p) => p.id === key)!;
const patch = (key: string, body: object, actor: Actor = ws.clinical) => request(app).patch(`/api/rule-packs/${key}`).set(as(actor)).send(body);
const events = async (key: string, w = ws) => prisma.auditEvent.findMany({ where: { orgId: w.orgId, resourceId: key, action: 'RULE_PACK_UPDATED' }, orderBy: { id: 'asc' } });

describe('GET /api/rule-packs', () => {
  it('lists the current version of every pathway pack, in pathway order, with the structured red-flag rule', async () => {
    const { rulePacks, clinicalLeads } = await list();
    expect(rulePacks.map((p) => p.id)).toEqual(['RP-CANCER', 'RP-NCD', 'RP-MALE', 'RP-MCH']);
    expect(rulePacks[0]).toMatchObject({ pathway: 'CANCER_SCREENING', version: 1, status: 'ACTIVE', ackSlaHours: 24, contactSlaHours: 12, evalTargetDays: 7, redFlagPolicy: { unacknowledgedHours: 24 } });
    expect(rulePacks[1]).toMatchObject({ ackSlaHours: 48, redFlagPolicy: { unacknowledgedHours: 4 } });
    expect(rulePacks[2].redFlagPolicy).toEqual({ unacknowledgedHours: null });
    expect(rulePacks[3]).toMatchObject({ status: 'COMING_SOON' });
    expect(clinicalLeads).toEqual([{ id: ws.clinical.id, name: 'Clara Clinical' }]);
    expect(rulePacks.every((p) => typeof p.redFlagRule === 'string' && p.redFlagRule.length > 0)).toBe(true);
  });

  it('is readable by every role and private to the organisation', async () => {
    for (const a of [ws.manager, ws.coordinator, ws.focalA, ws.clinical, ws.dpo]) expect((await request(app).get('/api/rule-packs').set(as(a))).status, a.name).toBe(200);
    expect((await request(app).get('/api/rule-packs')).status).toBe(401);
    const other = await makeWorkspace();
    const mine = (await list()).rulePacks.map((p) => p.version);
    await patch('RP-CANCER', { ackSlaHours: 20 }, other.clinical).expect(200);
    expect((await list()).rulePacks.map((p) => p.version)).toEqual(mine); // another organisation's edit does not touch ours
  });
});

describe('publishing a new version', () => {
  it('creates version 2, leaves version 1 intact, and records who approved it', async () => {
    const w = await makeWorkspace();
    const res = await patch('RP-CANCER', { ackSlaHours: 18, contactSlaHours: 6 }, w.clinical).expect(200);
    expect(res.body).toMatchObject({ id: 'RP-CANCER', version: 2, ackSlaHours: 18, contactSlaHours: 6, evalTargetDays: 7 });

    const rows = await prisma.rulePack.findMany({ where: { orgId: w.orgId, key: 'RP-CANCER' }, orderBy: { version: 'asc' } });
    expect(rows.map((r) => [r.version, r.ackSlaHours])).toEqual([[1, 24], [2, 18]]); // v1 untouched
    expect(rows[1].editedById).toBe(w.clinical.id);
    expect(rows[1].effectiveFrom.getTime()).toBeGreaterThan(rows[0].effectiveFrom.getTime() - 1);

    const versions = (await request(app).get('/api/rule-packs/RP-CANCER/versions').set(as(w.manager)).expect(200)).body.versions as RulePackVersionDto[];
    expect(versions.map((v) => [v.version, v.ackSlaHours, v.editedBy])).toEqual([[2, 18, 'Clara Clinical'], [1, 24, null]]);
  });

  it('audits exactly what changed, naming the approver', async () => {
    const w = await makeWorkspace();
    await patch('RP-NCD', { ackSlaHours: 36, redFlagPolicy: { unacknowledgedHours: 2 }, status: 'CONFIGURED' }, w.clinical).expect(200);
    const [ev] = await events('RP-NCD', w);
    expect(ev).toMatchObject({ actorId: w.clinical.id, actorLabel: 'Clara Clinical', resourceType: 'RulePack' });
    expect(ev.detail).toBe('NCD Screening Pathway (Hypertension & Diabetes): published v2 (was v1). ackSlaHours: 48 → 36; redFlagTimerHours: 4 → 2; status: "ACTIVE" → "CONFIGURED". Referrals already open keep their original rules.');
    expect(await verifyAuditChain(prisma, w.orgId)).toMatchObject({ ok: true });
  });

  it('a no-op change publishes nothing: no new version, no audit entry', async () => {
    const w = await makeWorkspace();
    const res = await patch('RP-CANCER', { ackSlaHours: 24, status: 'ACTIVE', redFlagPolicy: { unacknowledgedHours: 24 } }, w.clinical).expect(200);
    expect(res.body.version).toBe(1);
    expect(await prisma.rulePack.count({ where: { orgId: w.orgId, key: 'RP-CANCER' } })).toBe(1);
    expect(await events('RP-CANCER', w)).toHaveLength(0);
  });

  it('versions increase one at a time across successive edits', async () => {
    const w = await makeWorkspace();
    for (const hours of [22, 20, 18]) await patch('RP-CANCER', { ackSlaHours: hours }, w.clinical).expect(200);
    expect((await pack('RP-CANCER', w)).version).toBe(4);
    expect((await events('RP-CANCER', w)).length).toBe(3);
  });

  it('only the Partner Clinical Lead can change rules', async () => {
    for (const a of [ws.manager, ws.coordinator, ws.focalA, ws.dpo]) expect((await patch('RP-CANCER', { ackSlaHours: 20 }, a)).status, a.name).toBe(403);
    expect((await request(app).patch('/api/rule-packs/RP-CANCER').send({ ackSlaHours: 20 })).status).toBe(401);
    expect((await pack('RP-CANCER')).version).toBe(1);
  });

  it('unknown or malformed keys do not exist', async () => {
    for (const key of ['RP-NOPE', 'cancer', 'RP-', '..%2Fx']) expect((await patch(key, { ackSlaHours: 20 })).status, key).toBe(404);
  });
});

describe('open referrals keep the rules they were created under', () => {
  it('a new version applies to NEW referrals only; existing ones keep their pinned clock', async () => {
    const w = await makeWorkspace();
    const before = await createCase(w); // created under v1: 24h ack
    expect(Date.parse(before.slaDueAt!) - Date.parse(before.milestones.referralIssuedAt!)).toBe(24 * H);

    await patch('RP-CANCER', { ackSlaHours: 6, contactSlaHours: 3 }, w.clinical).expect(200);

    const after = await createCase(w); // created under v2: 6h ack
    expect(Date.parse(after.slaDueAt!) - Date.parse(after.milestones.referralIssuedAt!)).toBe(6 * H);

    const old = (await request(app).get(`/api/cases/${before.id}`).set(as(w.manager)).expect(200)).body as CaseDto;
    expect(old.slaDueAt).toBe(before.slaDueAt); // unchanged
    const pinned = await prisma.referralCase.findFirstOrThrow({ where: { orgId: w.orgId, refNumber: before.id }, include: { rulePack: true } });
    expect(pinned.rulePack.version).toBe(1);
    expect((await prisma.referralCase.findFirstOrThrow({ where: { orgId: w.orgId, refNumber: after.id }, include: { rulePack: true } })).rulePack.version).toBe(2);
  });

  it('an old referral still uses its OWN version’s timers when the clock is recomputed (acknowledgment → evaluation target)', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w); // v1: eval target 7 days
    await patch('RP-CANCER', { evalTargetDays: 30 }, w.clinical).expect(200);
    const acked = (await act(w.focalA, c.id, 'acknowledge').expect(200)).body as CaseDto;
    expect(Date.parse(acked.slaDueAt!) - Date.parse(acked.milestones.referralIssuedAt!)).toBe(7 * 24 * H); // not 30 days
  });

  it('marking a pathway Coming Soon stops new referrals but does not disturb open ones', async () => {
    const w = await makeWorkspace();
    const open = await createCase(w);
    await patch('RP-CANCER', { status: 'COMING_SOON' }, w.clinical).expect(200);
    const blocked = await request(app).post('/api/cases').set(as(w.coordinator)).send(caseBody(w));
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('PATHWAY_UNAVAILABLE');
    expect((await act(w.focalA, open.id, 'acknowledge')).status).toBe(200);
  });
});

describe('server-side validation (the UI’s own limits were never enforced)', () => {
  it.each([
    ['acknowledgment below the minimum', { ackSlaHours: 0 }],
    ['acknowledgment above the maximum', { ackSlaHours: 169 }],
    ['fractional hours', { ackSlaHours: 4.5 }],
    ['text instead of a number', { ackSlaHours: '24' }],
    ['evaluation target above the maximum', { evalTargetDays: 91 }],
    ['red-flag timer of zero', { redFlagPolicy: { unacknowledgedHours: 0 } }],
    ['empty change', {}],
    ['unknown status', { status: 'LIVE' }],
    ['wording with a line break', { redFlagRule: 'a\nb c' }],
  ])('rejects %s', async (_l, body) => {
    const res = await patch('RP-CANCER', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects timers that contradict each other, naming the field', async () => {
    const contact = await patch('RP-CANCER', { contactSlaHours: 30 }); // contact 30h > ack 24h
    expect(contact.status).toBe(400);
    expect(contact.body.error.details).toEqual([{ path: 'contactSlaHours', message: expect.stringMatching(/cannot be longer/) }]);
    const evalT = await patch('RP-CANCER', { ackSlaHours: 168, contactSlaHours: 12, evalTargetDays: 7 }); // 7d == 168h
    expect(evalT.body.error.details[0].path).toBe('evalTargetDays');
    const rf = await patch('RP-CANCER', { ackSlaHours: 6, contactSlaHours: 3, evalTargetDays: 1, redFlagPolicy: { unacknowledgedHours: 30 } });
    expect(rf.body.error.details[0].path).toBe('redFlagPolicy');
    expect((await pack('RP-CANCER')).version).toBe(1); // none of the rejected edits published anything
  });

  it('judges the combination, not just the field sent (lowering the acknowledgment window below the existing contact window)', async () => {
    const res = await patch('RP-CANCER', { ackSlaHours: 10 }); // contact stays 12h > 10h
    expect(res.status).toBe(400);
    expect((await patch('RP-CANCER', { ackSlaHours: 10, contactSlaHours: 5 }, (await makeWorkspace()).clinical)).status).toBe(200);
  });
});

describe('governance rules', () => {
  it('the clinical owner must be an active Partner Clinical Lead', async () => {
    const w = await makeWorkspace();
    for (const id of [w.coordinator.id, w.manager.id, 'nope', (await makeWorkspace()).clinical.id]) {
      const r = await patch('RP-CANCER', { clinicalOwnerId: id }, w.clinical);
      expect(r.status, id).toBe(422);
      expect(r.body.error.code).toBe('INVALID_REFERENCE');
    }
    await prisma.user.update({ where: { id: w.clinical.id }, data: { active: false } });
    expect((await patch('RP-CANCER', { clinicalOwnerId: w.clinical.id }, w.clinical)).status).toBe(401); // deactivated: cannot act at all
  });

  it('names an owner, then shows them; clearing is allowed on an active pack', async () => {
    const w = await makeWorkspace();
    const res = await patch('RP-CANCER', { clinicalOwnerId: w.clinical.id }, w.clinical).expect(200);
    expect(res.body.clinicalOwner).toEqual({ id: w.clinical.id, name: 'Clara Clinical' });
    expect((await patch('RP-CANCER', { clinicalOwnerId: null }, w.clinical).expect(200)).body.clinicalOwner).toBeNull();
  });

  it('activating a pathway requires a named clinical owner', async () => {
    const w = await makeWorkspace();
    const refused = await patch('RP-MALE', { status: 'ACTIVE' }, w.clinical); // Configured → Active, no owner
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('OWNER_REQUIRED');
    const ok = await patch('RP-MALE', { status: 'ACTIVE', clinicalOwnerId: w.clinical.id }, w.clinical).expect(200);
    expect(ok.body).toMatchObject({ status: 'ACTIVE', clinicalOwner: { name: 'Clara Clinical' } });
    // the rule applies to the TRANSITION: already-active packs without an owner can still be tuned
    expect((await patch('RP-NCD', { ackSlaHours: 40 }, w.clinical)).status).toBe(200);
  });
});

describe('concurrent edits', () => {
  it('rejects a change made against a stale version', async () => {
    const w = await makeWorkspace();
    await patch('RP-CANCER', { ackSlaHours: 20 }, w.clinical).expect(200); // now v2
    const stale = await patch('RP-CANCER', { ackSlaHours: 10, contactSlaHours: 5, expectedVersion: 1 }, w.clinical);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.error.message).toMatch(/now version 2/);
    expect((await patch('RP-CANCER', { ackSlaHours: 16, expectedVersion: 2 }, w.clinical)).status).toBe(200);
  });

  it('two simultaneous edits never produce a duplicate or skipped version', async () => {
    const w = await makeWorkspace();
    const other = await prisma.user.create({ data: { orgId: w.orgId, email: `c2.${Date.now()}@test.example`, passwordHash: 'x', name: 'Second Clinical', role: 'CLINICAL_LEAD', accessScope: 's' } });
    const { signAccessToken } = await import('../auth/tokens');
    const second: Actor = { id: other.id, name: other.name, token: signAccessToken(other.id, w.orgId) };
    const results = await Promise.all([patch('RP-CANCER', { ackSlaHours: 20 }, w.clinical), patch('RP-CANCER', { ackSlaHours: 18 }, second)]);
    expect(results.map((r) => r.status).sort(), JSON.stringify(results.map((r) => r.body))).toEqual([200, 409]);
    const versions = (await prisma.rulePack.findMany({ where: { orgId: w.orgId, key: 'RP-CANCER' }, orderBy: { version: 'asc' } })).map((r) => r.version);
    expect(versions).toEqual([1, 2]);
  });
});

describe('version history', () => {
  it('is readable by everyone, newest first, and 404 for an unknown pack', async () => {
    const w = await makeWorkspace();
    await patch('RP-NCD', { ackSlaHours: 40 }, w.clinical).expect(200);
    for (const a of [w.manager, w.focalA, w.dpo]) {
      const res = await request(app).get('/api/rule-packs/RP-NCD/versions').set(as(a)).expect(200);
      expect(res.body.versions.map((v: RulePackVersionDto) => v.version)).toEqual([2, 1]);
    }
    expect((await request(app).get('/api/rule-packs/RP-NOPE/versions').set(as(w.manager))).status).toBe(404);
  });
});

void H;

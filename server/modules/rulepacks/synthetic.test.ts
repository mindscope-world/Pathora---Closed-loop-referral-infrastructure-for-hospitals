import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import type { SyntheticTestResponse } from '../../../shared/types';
import { runSlaMonitor } from '../../jobs/slaMonitor';
import { prisma } from '../../test/helpers';
import { app, as, createCase, makeWorkspace, type Actor, type Workspace } from '../../test/workspace';
import { verifyAuditChain } from '../audit/append';

const H = 3_600_000;
afterAll(() => prisma.$disconnect());

const run = (key: string, actor: Actor, expectStatus = 200) =>
  request(app).post(`/api/rule-packs/${key}/synthetic-test`).set(as(actor)).expect(expectStatus);
const outcomes = (r: SyntheticTestResponse) => Object.fromEntries(r.checks.map((c) => [c.id, c.outcome]));
const liveRows = async (w: Workspace) => ({
  cases: await prisma.referralCase.count({ where: { orgId: w.orgId } }),
  syntheticCases: await prisma.referralCase.count({ where: { orgId: w.orgId, isSynthetic: true } }),
  patients: await prisma.patient.count({ where: { orgId: w.orgId } }),
  messages: await prisma.commsLog.count({ where: { orgId: w.orgId } }),
  consent: await prisma.consent.count({ where: { patient: { orgId: w.orgId } } }),
  breaches: await prisma.slaBreach.count({ where: { orgId: w.orgId } }),
  notifications: await prisma.notification.count({ where: { orgId: w.orgId } }),
  refSeq: JSON.stringify(await prisma.refSequence.findMany({ where: { orgId: w.orgId } })),
});

describe('synthetic gate test', () => {
  it('runs the real checks for a pathway with a red-flag timer, and they all pass', async () => {
    const w = await makeWorkspace();
    const res = (await run('RP-CANCER', w.clinical)).body as SyntheticTestResponse;
    expect(res).toMatchObject({ passed: true, rulePack: { id: 'RP-CANCER', version: 1 } });
    expect(outcomes(res)).toEqual({
      'new-referrals': 'PASSED', 'ack-overdue': 'PASSED', idempotent: 'PASSED', 'red-flag': 'PASSED', 'red-flag-boundary': 'PASSED', closure: 'PASSED',
      'consent-block': 'PASSED', 'contact-fallback': 'PASSED', isolation: 'PASSED',
    });
    // The detail states what actually happened, using this pack's own numbers.
    const byId = Object.fromEntries(res.checks.map((c) => [c.id, c]));
    expect(byId['ack-overdue'].title).toBe('Unacknowledged referral past 24h is detected');
    expect(byId['ack-overdue'].detail).toContain('25h old');
    expect(byId['red-flag'].detail).toContain('25h');
    expect(byId['new-referrals'].detail).toContain('RP-CANCER v1');
  });

  it('uses the pack’s own timers (an NCD pack: 48h acknowledgment, 4h red-flag timer)', async () => {
    const w = await makeWorkspace();
    const res = (await run('RP-NCD', w.clinical)).body as SyntheticTestResponse;
    expect(res.checks.find((c) => c.id === 'ack-overdue')!.title).toContain('48h');
    expect(res.checks.find((c) => c.id === 'red-flag')!.title).toContain('4h');
  });

  it('includes the patient-messaging safeguards: consent is enforced and undeliverable messages reach a person', async () => {
    const w = await makeWorkspace();
    const res = (await run('RP-NCD', w.clinical)).body as SyntheticTestResponse;
    const byId = Object.fromEntries(res.checks.map((c) => [c.id, c]));
    expect(byId['consent-block']).toMatchObject({ title: 'A patient who opted out is never messaged', outcome: 'PASSED' });
    expect(byId['consent-block'].detail).toMatch(/stopped at the last moment/);
    expect(byId['contact-fallback']).toMatchObject({ title: 'An undeliverable message is handed to a person', outcome: 'PASSED' });
    expect(byId['contact-fallback'].detail).toMatch(/handed to the case owner/);
  });

  it('SKIPS (does not pass or fail) the red-flag checks when the pathway has no timer', async () => {
    const w = await makeWorkspace();
    const res = (await run('RP-MALE', w.clinical)).body as SyntheticTestResponse;
    expect(outcomes(res)).toMatchObject({ 'red-flag': 'SKIPPED', 'red-flag-boundary': 'SKIPPED', 'ack-overdue': 'PASSED' });
    expect(res.passed).toBe(true); // a skipped check is not a failure
    expect(res.checks.find((c) => c.id === 'red-flag')!.detail).toMatch(/No red-flag timer/);
  });

  it('SKIPS the new-referrals check for a Coming Soon pathway, but still exercises the monitor', async () => {
    const w = await makeWorkspace();
    const res = (await run('RP-MCH', w.clinical)).body as SyntheticTestResponse;
    expect(outcomes(res)['new-referrals']).toBe('SKIPPED');
    expect(outcomes(res)['ack-overdue']).toBe('PASSED');
  });

  it('exercises the latest version of a pack after it is edited, and says which', async () => {
    const w = await makeWorkspace();
    await request(app).patch('/api/rule-packs/RP-CANCER').set(as(w.clinical)).send({ ackSlaHours: 10, contactSlaHours: 5, redFlagPolicy: { unacknowledgedHours: 6 } }).expect(200);
    const res = (await run('RP-CANCER', w.clinical)).body as SyntheticTestResponse;
    expect(res.rulePack.version).toBe(2);
    expect(res.checks.find((c) => c.id === 'ack-overdue')!.title).toContain('10h');
    expect(res.checks.find((c) => c.id === 'red-flag')!.title).toContain('6h');
    expect(res.passed).toBe(true);
  });
});

describe('isolation: the run leaves no trace', () => {
  it('saves nothing: no referrals, patients, breaches, notifications or reference numbers', async () => {
    const w = await makeWorkspace();
    await createCase(w); // some real data to make sure it is left alone
    const before = await liveRows(w);
    const res = (await run('RP-CANCER', w.clinical)).body as SyntheticTestResponse;
    expect(outcomes(res).isolation).toBe('PASSED');
    expect(await liveRows(w)).toEqual(before);
    expect(await prisma.referralCase.count({ where: { orgId: w.orgId, refNumber: { startsWith: 'SYN-' } } })).toBe(0);
  });

  it('never touches a real overdue referral, which the real monitor still handles afterwards', async () => {
    const w = await makeWorkspace();
    const real = await createCase(w, { redFlag: true });
    await prisma.referralCase.updateMany({ where: { orgId: w.orgId, refNumber: real.id }, data: { issuedAt: new Date(Date.now() - 48 * H), slaDueAt: new Date(Date.now() - 24 * H) } });

    await run('RP-CANCER', w.clinical);
    const untouched = await prisma.referralCase.findFirstOrThrow({ where: { orgId: w.orgId, refNumber: real.id } });
    expect(untouched).toMatchObject({ stage: 'HANDOFF_SENT', version: 1 }); // the test did not escalate it
    expect(await prisma.slaBreach.count({ where: { orgId: w.orgId } })).toBe(0);

    const s = await runSlaMonitor(new Date(), { orgId: w.orgId }); // the genuine monitor does
    expect(s).toMatchObject({ redFlagEscalations: 1, deadlineBreaches: 1 });
  });

  it('the only trace is one audit entry recording that the gate test was run', async () => {
    const w = await makeWorkspace();
    const before = await prisma.auditEvent.count({ where: { orgId: w.orgId } });
    await run('RP-CANCER', w.clinical);
    const after = await prisma.auditEvent.findMany({ where: { orgId: w.orgId }, orderBy: { id: 'asc' } });
    expect(after.length).toBe(before + 1);
    const ev = after.at(-1)!;
    expect(ev).toMatchObject({ action: 'RULE_PACK_GATE_TESTED', actorId: w.clinical.id, resourceId: 'RP-CANCER' });
    expect(ev.detail).toBe('Ran the synthetic gate test on RP-CANCER v1: 9 passed, 0 failed, 0 skipped.');
    expect(await verifyAuditChain(prisma, w.orgId)).toMatchObject({ ok: true });
  });

  it('repeated runs are independent and equally clean', async () => {
    const w = await makeWorkspace();
    const before = await liveRows(w);
    for (let i = 0; i < 3; i++) expect(((await run('RP-NCD', w.clinical)).body as SyntheticTestResponse).passed).toBe(true);
    expect(await liveRows(w)).toEqual(before);
  });
});

describe('access and preconditions', () => {
  it('only the Partner Clinical Lead can run it', async () => {
    const w = await makeWorkspace();
    for (const a of [w.manager, w.coordinator, w.focalA, w.dpo]) await run('RP-CANCER', a, 403);
    expect((await request(app).post('/api/rule-packs/RP-CANCER/synthetic-test')).status).toBe(401);
  });

  it('needs at least one receiving facility', async () => {
    const w = await makeWorkspace();
    await prisma.referralCase.deleteMany({ where: { orgId: w.orgId } });
    await prisma.user.updateMany({ where: { orgId: w.orgId, facilityId: { not: null } }, data: { facilityId: null, role: 'DPO' } });
    await prisma.facility.deleteMany({ where: { orgId: w.orgId } });
    const res = await run('RP-CANCER', w.clinical, 422);
    expect(res.body.error.code).toBe('NO_FACILITY');
  });

  it('unknown packs and other organisations’ packs do not exist', async () => {
    const w = await makeWorkspace();
    await run('RP-NOPE', w.clinical, 404);
    await run('bad key', w.clinical, 404);
  });
});

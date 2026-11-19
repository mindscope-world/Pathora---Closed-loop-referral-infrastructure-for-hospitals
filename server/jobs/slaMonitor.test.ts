import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { CaseDto } from '../../shared/types';
import { setMailer, type MailMessage, type Mailer } from '../lib/mailer';
import { verifyAuditChain } from '../modules/audit/append';
import { prisma } from '../test/helpers';
import { act, app, as, createCase, makeWorkspace, type Workspace } from '../test/workspace';
import { findCandidates, processBreach, runSlaMonitor } from './slaMonitor';

const H = 3_600_000;
afterAll(() => prisma.$disconnect());
afterEach(() => setMailer(undefined));

/** Runs the monitor for one organisation as if it were `hoursFromNow` hours in the future. */
const tick = (w: Workspace, hoursFromNow: number) => runSlaMonitor(new Date(Date.now() + hoursFromNow * H), { orgId: w.orgId });
const breaches = (w: Workspace, ref?: string) =>
  prisma.slaBreach.findMany({ where: { orgId: w.orgId, ...(ref ? { case: { refNumber: ref } } : {}) }, orderBy: { detectedAt: 'asc' } });
const audit = (w: Workspace, ref: string) => prisma.auditEvent.findMany({ where: { orgId: w.orgId, resourceId: ref }, orderBy: { id: 'asc' } });
const notes = (w: Workspace, ref: string) => prisma.notification.findMany({ where: { orgId: w.orgId, caseRef: ref } });
const dbCase = (w: Workspace, ref: string) => prisma.referralCase.findFirstOrThrow({ where: { orgId: w.orgId, refNumber: ref } });

describe('overdue detection', () => {
  it('records a missed acknowledgment deadline once: breach row, audit entry, notifications', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w, { patientName: 'Distinctive Patient' });
    const due = (await dbCase(w, c.id)).slaDueAt;

    const summary = await tick(w, 25); // 24h ack SLA, so 1h late
    expect(summary).toMatchObject({ deadlineBreaches: 1, redFlagEscalations: 0, errors: 0 });

    const [b] = await breaches(w, c.id);
    expect(b).toMatchObject({ kind: 'DEADLINE_PASSED', orgId: w.orgId });
    expect(b.deadline.getTime()).toBe(due.getTime());

    const ev = (await audit(w, c.id)).find((e) => e.action === 'SLA_BREACH_DETECTED')!;
    expect(ev).toMatchObject({ actorId: null, actorLabel: 'SLA Monitor', actorRole: 'System', resourceType: 'ReferralCase' });
    expect(ev.detail).toContain('Facility acknowledgment deadline passed 1h ago');
    expect(ev.detail).toContain(w.facilityA.name);
    expect(ev.detail).toContain('RP-CANCER v1');
    expect(await verifyAuditChain(prisma, w.orgId)).toMatchObject({ ok: true });

    // The case itself reads as overdue (derived), and the monitor did not change its stage.
    const live = await dbCase(w, c.id);
    expect(live.stage).toBe('HANDOFF_SENT');
    expect(live.version).toBe(1);
  });

  it('tells the named owner and the clinical lead, with text that carries no patient information', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w, { patientName: 'Distinctive Patient', patientCode: 'PT-SECRET1' });
    await tick(w, 25);
    const n = await notes(w, c.id);
    expect(n.map((x) => x.userId).sort()).toEqual([w.coordinator.id, w.clinical.id].sort());
    for (const x of n) {
      expect(x).toMatchObject({ kind: 'SLA_BREACH', title: `${c.id} is overdue`, readAt: null });
      expect(x.body).toContain(w.facilityA.name);
      expect(`${x.title} ${x.body}`).not.toMatch(/Distinctive|PT-SECRET1/);
    }
  });

  it('does not repeat itself: running again (even concurrently) changes nothing', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w);
    await tick(w, 25);
    const snapshot = async () => [(await breaches(w)).length, (await audit(w, c.id)).length, (await notes(w, c.id)).length];
    const first = await snapshot();
    expect((await tick(w, 25)).deadlineBreaches).toBe(0);
    expect((await tick(w, 40)).deadlineBreaches).toBe(0); // later, same missed deadline: still the same breach
    expect(await snapshot()).toEqual(first);
  });

  it('is exact-once even when several monitors run at the same moment', async () => {
    const w = await makeWorkspace();
    const refs: string[] = [];
    for (let i = 0; i < 6; i++) refs.push((await createCase(w)).id);
    const runs = await Promise.all([tick(w, 25), tick(w, 25), tick(w, 25)]);
    expect(runs.reduce((n, r) => n + r.deadlineBreaches, 0)).toBe(6);
    expect(runs.every((r) => r.errors === 0)).toBe(true);
    for (const ref of refs) {
      expect(await breaches(w, ref), ref).toHaveLength(1);
      expect((await audit(w, ref)).filter((e) => e.action === 'SLA_BREACH_DETECTED'), ref).toHaveLength(1);
      expect(await notes(w, ref), ref).toHaveLength(2);
    }
    expect(await verifyAuditChain(prisma, w.orgId)).toMatchObject({ ok: true });
  });

  it('the deadline is strict: exactly on time is not overdue, one millisecond late is', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w);
    const due = (await dbCase(w, c.id)).slaDueAt;
    expect((await runSlaMonitor(due, { orgId: w.orgId })).deadlineBreaches).toBe(0);
    expect((await runSlaMonitor(new Date(due.getTime() + 1), { orgId: w.orgId })).deadlineBreaches).toBe(1);
  });

  it('does not flag a referral before its deadline', async () => {
    const w = await makeWorkspace();
    await createCase(w);
    expect((await tick(w, 23)).deadlineBreaches).toBe(0);
    expect(await breaches(w)).toHaveLength(0);
  });

  it('follows the clock the case is actually on: acknowledgment moves it to the evaluation target', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w);
    await act(w.focalA, c.id, 'acknowledge').expect(200);
    expect((await tick(w, 30)).deadlineBreaches).toBe(0); // past the 24h ack SLA, but that deadline no longer applies
    expect((await tick(w, 7 * 24 + 1)).deadlineBreaches).toBe(1); // past the 7-day evaluation target
    expect((await audit(w, c.id)).find((e) => e.action === 'SLA_BREACH_DETECTED')!.detail).toContain('The next required action deadline passed');

    const d = await createCase(w);
    await act(w.focalA, d.id, 'acknowledge').expect(200);
    await act(w.focalA, d.id, 'attendance').expect(200);
    await tick(w, 7 * 24 + 1);
    expect((await audit(w, d.id)).find((e) => e.action === 'SLA_BREACH_DETECTED')!.detail).toContain('Outcome documentation deadline passed');
  });

  it('never flags a closed referral, however late', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w);
    await act(w.focalA, c.id, 'acknowledge').expect(200);
    await act(w.focalA, c.id, 'attendance').expect(200);
    await act(w.focalA, c.id, 'close', { closureReason: 'Care plan documented' }).expect(200);
    expect((await tick(w, 24 * 100)).deadlineBreaches).toBe(0);
    expect(await breaches(w)).toHaveLength(0);
  });

  it('a resolved barrier gives a fresh deadline, which can legitimately breach again', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w);
    await tick(w, 25);
    await act(w.coordinator, c.id, 'barrier-resolution', { note: 'Rebooked the appointment' }).expect(200); // deadline = now + 12h
    expect((await tick(w, 30)).deadlineBreaches).toBe(1); // 12h window passed
    const rows = await breaches(w, c.id);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.deadline.getTime())).size).toBe(2); // two different missed deadlines
    expect((await audit(w, c.id)).filter((e) => e.action === 'SLA_BREACH_DETECTED')).toHaveLength(2);
  });

  it('still records a breach on a case a person already escalated', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w);
    await act(w.coordinator, c.id, 'escalate', { reason: 'Facility silent' }).expect(200);
    expect((await tick(w, 25)).deadlineBreaches).toBe(1);
  });

  it('ignores synthetic fixtures and other organisations', async () => {
    const [a, b] = [await makeWorkspace(), await makeWorkspace()];
    const real = await createCase(a);
    const other = await createCase(b);
    await prisma.referralCase.updateMany({ where: { orgId: a.orgId, refNumber: real.id }, data: { isSynthetic: true } });
    expect((await tick(a, 25)).deadlineBreaches).toBe(0); // synthetic: ignored
    await prisma.referralCase.updateMany({ where: { orgId: a.orgId, refNumber: real.id }, data: { isSynthetic: false } });
    await tick(a, 25);
    expect(await breaches(b, other.id)).toHaveLength(0); // org B untouched by a run scoped to org A
    expect(await breaches(a, real.id)).toHaveLength(1);
  });
});

describe('red-flag escalation', () => {
  it('escalates a red-flag referral unacknowledged past its timer, for human follow-up', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w, { redFlag: true }); // cancer: 24h red-flag timer
    const summary = await tick(w, 25);
    expect(summary).toMatchObject({ redFlagEscalations: 1, deadlineBreaches: 1, errors: 0 }); // the 24h ack deadline has also passed

    const live = await dbCase(w, c.id);
    expect(live).toMatchObject({ stage: 'ESCALATED', version: 2 });
    expect(live.notes).toContain('Auto-escalated: Red-flag referral not acknowledged within 24h; escalated automatically');

    // escalation is recorded first, then the missed deadline
    expect((await audit(w, c.id)).map((e) => e.action)).toEqual(['CASE_CREATED', 'SLA_ESCALATION_TRIGGERED', 'SLA_BREACH_DETECTED']);
    const esc = (await audit(w, c.id))[1];
    expect(esc).toMatchObject({ actorLabel: 'SLA Monitor', actorRole: 'System' });
    expect(esc.detail).toBe(`Red-flag referral not acknowledged by ${w.facilityA.name} within 24h; escalated for human follow-up (rule RP-CANCER v1).`);

    const n = await notes(w, c.id);
    expect(n.map((x) => x.kind).sort()).toEqual(['RED_FLAG_ESCALATION', 'RED_FLAG_ESCALATION', 'SLA_BREACH', 'SLA_BREACH']);
    expect(n.find((x) => x.kind === 'RED_FLAG_ESCALATION')!.title).toBe(`${c.id}: red-flag referral escalated`);
  });

  it('uses each pathway’s own timer: NCD escalates after 4 hours, before its 48h acknowledgment deadline', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w, { pathway: 'NCD_SCREENING', redFlag: true });
    expect((await tick(w, 3)).redFlagEscalations).toBe(0); // inside the window
    const s = await tick(w, 5);
    expect(s).toMatchObject({ redFlagEscalations: 1, deadlineBreaches: 0 });
    expect((await dbCase(w, c.id)).stage).toBe('ESCALATED');
  });

  it('leaves alone: non-red-flag cases, acknowledged cases, already-escalated cases, and pathways with no timer', async () => {
    const w = await makeWorkspace();
    const plain = await createCase(w, { pathway: 'NCD_SCREENING' });
    const acked = await createCase(w, { pathway: 'NCD_SCREENING', redFlag: true });
    await act(w.focalA, acked.id, 'acknowledge').expect(200);
    const manual = await createCase(w, { pathway: 'NCD_SCREENING', redFlag: true });
    await act(w.coordinator, manual.id, 'escalate', { reason: 'Already on it' }).expect(200);
    const noTimer = await createCase(w, { pathway: 'MALE_REPRODUCTIVE_HEALTH', redFlag: true }); // configured, no red-flag timer

    expect((await tick(w, 6)).redFlagEscalations).toBe(0);
    expect((await dbCase(w, plain.id)).stage).toBe('HANDOFF_SENT');
    expect((await dbCase(w, acked.id)).stage).toBe('ACKNOWLEDGED');
    expect((await dbCase(w, manual.id)).version).toBe(2); // only the human's escalation
    expect((await dbCase(w, noTimer.id)).stage).toBe('HANDOFF_SENT');
  });

  it('does not escalate the same missed deadline twice, even after a person clears the escalation', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w, { pathway: 'NCD_SCREENING', redFlag: true });
    await tick(w, 5);
    await act(w.coordinator, c.id, 'barrier-resolution', { note: 'Phoned the facility' }).expect(200);
    expect((await dbCase(w, c.id)).stage).toBe('HANDOFF_SENT');
    expect((await tick(w, 5)).redFlagEscalations).toBe(0);
    expect((await dbCase(w, c.id)).stage).toBe('HANDOFF_SENT'); // a person decided; the monitor does not override them
  });

  it('follows the pack version the referral was created under, not the current one', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w, { pathway: 'NCD_SCREENING', redFlag: true }); // v1: 4h timer
    await request(app).patch('/api/rule-packs/RP-NCD').set(as(w.clinical)).send({ redFlagPolicy: { unacknowledgedHours: 24 } }).expect(200); // v2: 24h
    expect((await tick(w, 5)).redFlagEscalations).toBe(1); // still escalated at v1's 4h
    expect((await dbCase(w, c.id)).stage).toBe('ESCALATED');
  });

  it('a malformed stored policy means "no timer": it never crashes or errors the run', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w, { pathway: 'NCD_SCREENING', redFlag: true });
    await prisma.rulePack.updateMany({ where: { orgId: w.orgId, key: 'RP-NCD' }, data: { redFlagPolicy: { unacknowledgedHours: 'soon' } } });
    const s = await tick(w, 6);
    expect(s).toMatchObject({ redFlagEscalations: 0, errors: 0 });
    expect((await dbCase(w, c.id)).stage).toBe('HANDOFF_SENT');
    await prisma.rulePack.updateMany({ where: { orgId: w.orgId, key: 'RP-NCD' }, data: { redFlagPolicy: null as never } }).catch(() => undefined);
  });
});

describe('who is notified', () => {
  it('only the pack’s named clinical owner (not every clinical lead) when one is set', async () => {
    const w = await makeWorkspace();
    const second = await prisma.user.create({ data: { orgId: w.orgId, email: `cl2.${Date.now()}@test.example`, passwordHash: 'x', name: 'Other Clinical', role: 'CLINICAL_LEAD', accessScope: 's' } });
    await request(app).patch('/api/rule-packs/RP-CANCER').set(as(w.clinical)).send({ clinicalOwnerId: w.clinical.id }).expect(200);
    const c = await createCase(w);
    await tick(w, 25);
    const ids = (await notes(w, c.id)).map((n) => n.userId).sort();
    expect(ids).toEqual([w.coordinator.id, w.clinical.id].sort());
    expect(ids).not.toContain(second.id);
  });

  it('everyone gets exactly one notification: no duplicates when the owner is also a clinical lead', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w);
    await prisma.referralCase.updateMany({ where: { orgId: w.orgId, refNumber: c.id }, data: { coordinatorId: w.clinical.id } });
    await tick(w, 25);
    expect(await notes(w, c.id)).toHaveLength(1);
  });

  it('skips deactivated people', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w);
    await prisma.user.update({ where: { id: w.coordinator.id }, data: { active: false } });
    await tick(w, 25);
    expect((await notes(w, c.id)).map((n) => n.userId)).toEqual([w.clinical.id]);
  });

  it('still records the breach when there is nobody to tell', async () => {
    const w = await makeWorkspace();
    const c = await createCase(w);
    await prisma.user.update({ where: { id: w.coordinator.id }, data: { active: false } });
    await prisma.user.update({ where: { id: w.clinical.id }, data: { active: false } });
    expect((await tick(w, 25)).deadlineBreaches).toBe(1);
    expect(await notes(w, c.id)).toHaveLength(0);
    expect(await breaches(w, c.id)).toHaveLength(1);
  });
});

describe('email alerts', () => {
  const capturing = () => {
    const sent: MailMessage[] = [];
    const mailer: Mailer = { configured: true, send: async (m) => void sent.push(m) };
    return { sent, mailer };
  };

  it('emails each recipient when a mailer is configured, without patient details', async () => {
    const w = await makeWorkspace();
    const { sent, mailer } = capturing();
    setMailer(mailer);
    const c = await createCase(w, { patientName: 'Distinctive Patient', patientCode: 'PT-SECRET2' });
    const s = await tick(w, 25);
    expect(s.emailsSent).toBe(2);
    expect(sent).toHaveLength(2);
    for (const m of sent) {
      expect(m.subject).toBe(`Pathora: ${c.id} is overdue`);
      expect(m.text).toContain(w.facilityA.name);
      expect(m.text).toContain('http://localhost:3000');
      expect(m.text).not.toMatch(/Distinctive|PT-SECRET2/);
    }
    expect(await prisma.user.findMany({ where: { email: { in: sent.map((m) => m.to) } } })).toHaveLength(2);
  });

  it('a failing mail server never blocks detection: the notification and breach still exist', async () => {
    const w = await makeWorkspace();
    setMailer({ configured: true, send: async () => { throw new Error('SMTP down'); } });
    const c = await createCase(w);
    const s = await tick(w, 25);
    expect(s).toMatchObject({ deadlineBreaches: 1, emailsSent: 0, errors: 0 });
    expect(await notes(w, c.id)).toHaveLength(2);
  });

  it('sends nothing when no mailer is configured', async () => {
    const w = await makeWorkspace();
    await createCase(w);
    expect((await tick(w, 25)).emailsSent).toBe(0);
  });
});

describe('processBreach re-checks before acting (a candidate can be stale by the time it is processed)', () => {
  const process_ = (caseId: string, kind: 'DEADLINE_PASSED' | 'RED_FLAG_UNACKNOWLEDGED', hoursFromNow: number) =>
    prisma.$transaction((tx) => processBreach(tx, caseId, kind, new Date(Date.now() + hoursFromNow * H)));

  it('does nothing for a red-flag referral still inside its window, and for a deadline not yet passed', async () => {
    const w = await makeWorkspace();
    const rf = await createCase(w, { pathway: 'NCD_SCREENING', redFlag: true }); // 4h timer
    const plain = await createCase(w);                                           // 24h ack deadline
    const [rfId, plainId] = [(await dbCase(w, rf.id)).id, (await dbCase(w, plain.id)).id];

    expect(await process_(rfId, 'RED_FLAG_UNACKNOWLEDGED', 3)).toBeNull();
    expect(await process_(plainId, 'DEADLINE_PASSED', 23)).toBeNull();
    expect(await breaches(w)).toHaveLength(0);
    expect((await dbCase(w, rf.id)).stage).toBe('HANDOFF_SENT');
    expect(await audit(w, rf.id)).toHaveLength(1); // only CASE_CREATED
  });

  it('does nothing if the case moved on since it was found: closed, acknowledged, or already escalated', async () => {
    const w = await makeWorkspace();
    const acked = await createCase(w, { pathway: 'NCD_SCREENING', redFlag: true });
    await act(w.focalA, acked.id, 'acknowledge').expect(200);
    const esc = await createCase(w, { pathway: 'NCD_SCREENING', redFlag: true });
    await act(w.coordinator, esc.id, 'escalate', { reason: 'Handled by a person' }).expect(200);
    const closed = await createCase(w);
    await act(w.focalA, closed.id, 'acknowledge').expect(200);
    await act(w.focalA, closed.id, 'attendance').expect(200);
    await act(w.focalA, closed.id, 'close', { closureReason: 'Care plan documented' }).expect(200);

    expect(await process_((await dbCase(w, acked.id)).id, 'RED_FLAG_UNACKNOWLEDGED', 10)).toBeNull();
    expect(await process_((await dbCase(w, esc.id)).id, 'RED_FLAG_UNACKNOWLEDGED', 10)).toBeNull();
    expect(await process_((await dbCase(w, closed.id)).id, 'DEADLINE_PASSED', 24 * 100)).toBeNull();
    expect(await breaches(w)).toHaveLength(0);
  });

  it('an unknown case is a no-op, not an error', async () => {
    expect(await process_('does-not-exist', 'DEADLINE_PASSED', 100)).toBeNull();
  });
});

describe('findCandidates', () => {
  it('can be restricted to specific cases, so the synthetic test never touches real referrals', async () => {
    const w = await makeWorkspace();
    const [a, b] = [await createCase(w), await createCase(w)];
    const idA = (await dbCase(w, a.id)).id;
    const later = new Date(Date.now() + 25 * H);
    const scoped = await findCandidates(prisma, later, { orgId: w.orgId, caseIds: [idA] });
    expect(scoped.map((c) => c.caseId)).toEqual([idA]);
    expect((await findCandidates(prisma, later, { orgId: w.orgId })).length).toBe(2);
    void b;
  });
});

void (null as unknown as CaseDto);
void request;

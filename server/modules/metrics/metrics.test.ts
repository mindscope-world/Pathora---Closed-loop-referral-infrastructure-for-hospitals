import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CaseDto, OverviewMetricsDto, UpcomingMetricsDto } from '../../../shared/types';
import { FUNNEL_STEPS } from '../../../shared/types';
import { prisma } from '../../test/helpers';
import { act, advance, app, as, createCase, makeWorkspace, type Actor, type Workspace } from '../../test/workspace';
import { hoursToAcknowledge, hoursToClose, median, startOfDayEat, upcomingWindow, type MetricRow } from './compute';

const H = 3_600_000;
const DAY = 24 * H;
let ws: Workspace;

afterAll(() => prisma.$disconnect());

const overview = async (actor: Actor = ws.manager) => (await request(app).get('/api/metrics/overview').set(as(actor)).expect(200)).body as OverviewMetricsDto;
const upcoming = async (actor: Actor = ws.manager) => (await request(app).get('/api/metrics/upcoming').set(as(actor)).expect(200)).body as UpcomingMetricsDto;
const allCases = async (actor: Actor = ws.manager) => (await request(app).get('/api/cases?limit=200').set(as(actor)).expect(200)).body.cases as CaseDto[];
const setCase = (w: Workspace, ref: string, data: object) => prisma.referralCase.updateMany({ where: { orgId: w.orgId, refNumber: ref }, data });

/** "2026-11-20" for an instant, as a person in Nairobi would read the calendar. */
const eatDay = (d: Date) => new Date(d.getTime() + 3 * H).toISOString().slice(0, 10);

// ── The formulas the Overview screen used to compute in the browser, kept here verbatim as the reference ──
function legacyClient(cases: CaseDto[], now: Date) {
  const total = cases.length;
  const open = cases.filter((c) => c.status !== 'CLOSED_VERIFIED');
  const pending = cases.filter(
    (c) => c.status !== 'CLOSED_VERIFIED' && (Boolean(c.milestones.facilityAcknowledgedAt) || c.stage === 'ACKNOWLEDGED' || c.stage === 'ATTENDED' || c.status === 'AWAITING_ACK' || c.status === 'OVERDUE_SLA'),
  );
  const attendedAwaiting = cases.filter((c) => c.status !== 'CLOSED_VERIFIED' && Boolean(c.milestones.patientAttendedAt)).length;
  const refMs = Date.parse(eatDay(now));
  const up = cases
    .filter((c) => {
      if (c.status === 'CLOSED_VERIFIED') return false;
      const diff = (Date.parse(eatDay(new Date(c.dueDate))) - refMs) / DAY;
      return (diff >= 0 && diff <= 7) || Boolean(c.milestones.facilityAcknowledgedAt && !c.milestones.patientAttendedAt);
    })
    .sort((a, b) => eatDay(new Date(a.dueDate)).localeCompare(eatDay(new Date(b.dueDate))));
  const closed = cases.filter((c) => c.status === 'CLOSED_VERIFIED').length;
  return {
    total, active: open.length, pending: pending.length, attendedAwaiting, upcoming: up,
    overdue: cases.filter((c) => c.status === 'OVERDUE_SLA').length, closed,
    completionRate: total > 0 ? Math.round((closed / total) * 100) : 0,
    funnel: FUNNEL_STEPS.map((s) => cases.filter((c) => (s.stages as readonly string[]).includes(c.stage)).length),
    pathway: (p: string) => {
      const mine = cases.filter((c) => c.pathway === p);
      return { cases: mine.length, acknowledged: mine.filter((c) => c.milestones.facilityAcknowledgedAt).length, closedVerified: mine.filter((c) => c.status === 'CLOSED_VERIFIED').length };
    },
  };
}

describe('metrics: agree with what the dashboard computed itself', () => {
  beforeAll(async () => {
    ws = await makeWorkspace();
    const today = startOfDayEat(new Date());
    const mk = (over: Parameters<typeof createCase>[1] = {}) => createCase(ws, over);

    const fresh = await mk();                                   // awaiting ack, due today (default)
    const acked = await mk({ pathway: 'NCD_SCREENING' });
    await advance(ws, acked.id, 'ack');
    const attended = await mk({ pathway: 'MALE_REPRODUCTIVE_HEALTH', facilityId: ws.facilityB.id });
    await advance(ws, attended.id, 'attended');
    const closed = await mk();
    await advance(ws, closed.id, 'closed');
    const closed2 = await mk({ pathway: 'NCD_SCREENING', facilityId: ws.facilityB.id });
    await advance(ws, closed2.id, 'closed');
    const overdue = await mk();
    const escalated = await mk({ pathway: 'NCD_SCREENING' });
    await act(ws.coordinator, escalated.id, 'escalate', { reason: 'Facility unreachable' }).expect(200);
    const redFlag = await mk({ redFlag: true } as never);
    const later = await mk({ facilityId: ws.facilityB.id });
    const boundaryIn = await mk();
    const boundaryOut = await mk();
    const eatMidnight = await mk();
    const ackedFar = await mk();                                // acknowledged, appointment far in the future
    await advance(ws, ackedFar.id, 'ack');

    await setCase(ws, overdue.id, { issuedAt: new Date(Date.now() - 80 * H), slaDueAt: new Date(Date.now() - 5 * H), dueDate: new Date(today.getTime() - 2 * DAY) });
    await setCase(ws, later.id, { dueDate: new Date(today.getTime() + 3 * DAY) });
    await setCase(ws, boundaryIn.id, { dueDate: new Date(today.getTime() + 7 * DAY + 20 * H) });  // last hour-of-day of day +7 (EAT)
    await setCase(ws, boundaryOut.id, { dueDate: new Date(today.getTime() + 8 * DAY + 1 * H) });  // first hour of day +8
    await setCase(ws, eatMidnight.id, { dueDate: new Date(today.getTime() + 30 * 60_000) });     // 00:30 EAT today = previous day in UTC
    await setCase(ws, ackedFar.id, { dueDate: new Date(today.getTime() + 60 * DAY) });
    await setCase(ws, fresh.id, { dueDate: new Date(today.getTime() - 20 * DAY) });               // past, not acked: not upcoming

    // A simulation case and another organisation's referrals must never be counted.
    await prisma.referralCase.create({
      data: {
        refNumber: 'REF-9999-0002', orgId: ws.orgId, isSynthetic: true, pathway: 'CANCER_SCREENING', sourceProgram: 'synthetic', stage: 'ACKNOWLEDGED',
        patientId: (await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId } })).patientId,
        rulePackId: (await prisma.rulePack.findFirstOrThrow({ where: { orgId: ws.orgId } })).id,
        coordinatorId: ws.coordinator.id, facilityId: ws.facilityA.id, issuedAt: new Date(), slaDueAt: new Date(Date.now() + H), dueDate: new Date(),
      },
    });
    const other = await makeWorkspace();
    await createCase(other);
  });

  it('matches the old in-browser formulas on a mixed dataset', async () => {
    const now = new Date();
    const cases = await allCases();
    expect(cases.length).toBeGreaterThanOrEqual(12);
    const want = legacyClient(cases, now);
    const got = await overview();

    expect(got.total).toBe(want.total);
    expect(got.activeReferrals).toBe(want.active);
    expect(got.pendingCareCompletions).toBe(want.pending);
    expect(got.attendedAwaitingOutcome).toBe(want.attendedAwaiting);
    expect(got.statusCounts.overdueSla).toBe(want.overdue);
    expect(got.statusCounts.closedVerified).toBe(want.closed);
    expect(got.completionRate).toBe(want.completionRate);
    expect(got.funnel.map((f) => f.count)).toEqual(want.funnel);
    expect(got.funnel.map((f) => f.percent)).toEqual(want.funnel.map((n) => Math.round((n / want.total) * 100)));
    for (const p of got.pathways) expect(p, p.pathway).toMatchObject(want.pathway(p.pathway));
    expect(Object.values(got.statusCounts).reduce((a, b) => a + b, 0)).toBe(got.total);

    const up = await upcoming();
    expect(up.count).toBe(want.upcoming.length);
    expect(up.cases.map((c) => c.id).sort()).toEqual(want.upcoming.slice(0, 10).map((c) => c.id).sort());
    expect(up.cases.map((c) => eatDay(new Date(c.dueDate)))).toEqual([...up.cases.map((c) => eatDay(new Date(c.dueDate)))].sort()); // soonest first
  });

  it('upcoming: day +7 (EAT) is in, day +8 is out, and 00:30 EAT today is still "today"', async () => {
    const up = await upcoming();
    const days = up.cases.map((c) => eatDay(new Date(c.dueDate)));
    const today = eatDay(new Date());
    expect(days).toContain(today);
    expect(days).toContain(eatDay(new Date(Date.now() + 7 * DAY)));
    expect(days).not.toContain(eatDay(new Date(Date.now() + 8 * DAY)));
    expect(up.windowStart).toBe(startOfDayEat(new Date()).toISOString());
  });

  it('upcoming: an acknowledged-but-unattended referral counts however far off, a closed one never does', async () => {
    const up = await upcoming();
    expect(up.cases.some((c) => eatDay(new Date(c.dueDate)) === eatDay(new Date(Date.now() + 60 * DAY)))).toBe(true);
    expect(up.cases.every((c) => c.status !== 'CLOSED_VERIFIED')).toBe(true);
  });

  it('excludes simulation referrals and other organisations', async () => {
    const got = await overview();
    expect(got.total).toBe((await allCases()).length);
    expect(await prisma.referralCase.count({ where: { orgId: ws.orgId } })).toBe(got.total + 1); // +1 synthetic
  });

  it('a facility focal sees only their own facility, and numbers add up', async () => {
    const mine = (await allCases(ws.focalA)).length;
    const got = await overview(ws.focalA);
    expect(got.total).toBe(mine);
    expect(got.total).toBeLessThan((await overview()).total);
    const up = await upcoming(ws.focalA);
    expect(up.cases.every((c) => c.facility.id === ws.facilityA.id)).toBe(true);
  });

  it('every role can read; unauthenticated callers cannot', async () => {
    for (const actor of [ws.manager, ws.coordinator, ws.focalA, ws.clinical, ws.dpo]) {
      await request(app).get('/api/metrics/overview').set(as(actor)).expect(200);
      await request(app).get('/api/metrics/upcoming').set(as(actor)).expect(200);
    }
    await request(app).get('/api/metrics/overview').expect(401);
    await request(app).get('/api/metrics/upcoming').expect(401);
  });

  it('never exposes patient names in the overview, and is not cacheable', async () => {
    const res = await request(app).get('/api/metrics/overview').set(as(ws.manager)).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(res.body)).not.toContain('Wanjiru');
  });
});

describe('metrics: an empty programme', () => {
  it('returns zeros and nulls, not NaN or an error', async () => {
    const empty = await makeWorkspace();
    const got = (await request(app).get('/api/metrics/overview').set(as(empty.manager)).expect(200)).body as OverviewMetricsDto;
    expect(got).toMatchObject({ total: 0, activeReferrals: 0, completionRate: 0, medianHoursToAcknowledge: null, medianHoursToClose: null, acknowledgedSample: 0, closedSample: 0 });
    expect(got.funnel.every((f) => f.count === 0 && f.percent === 0)).toBe(true);
    const up = (await request(app).get('/api/metrics/upcoming').set(as(empty.manager)).expect(200)).body as UpcomingMetricsDto;
    expect(up).toMatchObject({ count: 0, cases: [] });
  });
});

describe('metrics: time to acknowledge and to close', () => {
  it('reports medians (hours, one decimal) over acknowledged and closed referrals', async () => {
    const w = await makeWorkspace();
    const gaps = [2, 4, 10]; // hours from issue to acknowledgement → median 4
    const refs: string[] = [];
    for (const g of gaps) {
      const c = await createCase(w);
      await advance(w, c.id, 'ack');
      const row = await prisma.referralCase.findFirstOrThrow({ where: { orgId: w.orgId, refNumber: c.id } });
      const issued = new Date('2026-11-01T08:00:00Z');
      await prisma.caseMilestone.update({ where: { caseId_type: { caseId: row.id, type: 'REFERRAL_ISSUED' } }, data: { occurredAt: issued } });
      await prisma.caseMilestone.update({ where: { caseId_type: { caseId: row.id, type: 'FACILITY_ACKNOWLEDGED' } }, data: { occurredAt: new Date(issued.getTime() + g * H) } });
      refs.push(c.id);
    }
    // Two of them close, 20h and 31h after issue → median 25.5
    for (const [i, hours] of [20, 31].entries()) {
      await act(w.focalA, refs[i], 'attendance').expect(200);
      await act(w.focalA, refs[i], 'close', { closureReason: 'Clinical evaluation completed' }).expect(200);
      const row = await prisma.referralCase.findFirstOrThrow({ where: { orgId: w.orgId, refNumber: refs[i] } });
      await prisma.caseMilestone.update({ where: { caseId_type: { caseId: row.id, type: 'OUTCOME_DOCUMENTED' } }, data: { occurredAt: new Date(new Date('2026-11-01T08:00:00Z').getTime() + hours * H) } });
    }
    const got = (await request(app).get('/api/metrics/overview').set(as(w.manager)).expect(200)).body as OverviewMetricsDto;
    expect(got.medianHoursToAcknowledge).toBe(4);
    expect(got.acknowledgedSample).toBe(3);
    expect(got.medianHoursToClose).toBe(25.5);
    expect(got.closedSample).toBe(2);
  });
});

describe('metrics helpers', () => {
  const row = (over: Partial<MetricRow> = {}): MetricRow => ({
    stage: 'HANDOFF_SENT', pathway: 'CANCER_SCREENING', facilityId: 'f', slaDueAt: new Date(), redFlag: false,
    issuedAt: new Date('2026-11-01T00:00:00Z'), closedAt: null, milestones: [], ...over,
  });

  it('median: odd, even, empty, and rounding', () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2])).toBe(1.5);
    expect(median([1.04, 1.06, 1.21])).toBe(1.1);
  });

  it('ignores impossible (negative) gaps and unfinished referrals', () => {
    const issued = new Date('2026-11-01T10:00:00Z');
    const ack = (at: string) => [{ type: 'FACILITY_ACKNOWLEDGED', occurredAt: new Date(at) }];
    expect(hoursToAcknowledge(row({ milestones: ack('2026-11-01T13:00:00Z'), issuedAt: issued }))).toBe(3);
    expect(hoursToAcknowledge(row({ milestones: ack('2026-11-01T09:00:00Z'), issuedAt: issued }))).toBeNull();
    expect(hoursToAcknowledge(row())).toBeNull();
    expect(hoursToClose(row({ stage: 'ATTENDED' }))).toBeNull();
    expect(hoursToClose(row({ stage: 'CLOSED', closedAt: new Date('2026-11-02T01:00:00Z') }))).toBe(25);
  });

  it('start of day in Nairobi: 21:00 UTC is already tomorrow', () => {
    expect(startOfDayEat(new Date('2026-11-19T20:59:59Z')).toISOString()).toBe('2026-11-18T21:00:00.000Z');
    expect(startOfDayEat(new Date('2026-11-19T21:00:00Z')).toISOString()).toBe('2026-11-19T21:00:00.000Z');
    const w = upcomingWindow(new Date('2026-11-20T10:00:00Z'));
    expect(w.from.toISOString()).toBe('2026-11-19T21:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-11-27T21:00:00.000Z');
  });
});

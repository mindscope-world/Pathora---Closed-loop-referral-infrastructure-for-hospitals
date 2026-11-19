import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OverviewMetricsDto, ReportScheduleDto } from '../../../shared/types';
import { processPending } from '../../jobs/exportWorker';
import { queueScheduledReport, runReportScheduler } from '../../jobs/reportScheduler';
import { LocalFileStore, setFileStore } from '../../storage/fileStore';
import { prisma } from '../../test/helpers';
import { act, advance, app, as, createCase, makeWorkspace, type Actor, type Workspace } from '../../test/workspace';
import { GOVERNANCE_COLUMNS } from '../exports/generators';
import { MAX_SCHEDULES_PER_ORG } from './service';
import { nextRunAfter, periodFor } from './schedule';

const H = 3_600_000;
let ws: Workspace;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pathora-reports-'));
  setFileStore(new LocalFileStore(dir));
  ws = await makeWorkspace();
});
afterAll(async () => {
  setFileStore(undefined);
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});
afterEach(() => processPending());

const create = (body: object, actor: Actor = ws.manager) => request(app).post('/api/report-schedules').set(as(actor)).send(body);
const list = async (actor: Actor = ws.manager) => (await request(app).get('/api/report-schedules').set(as(actor)).expect(200)).body.schedules as ReportScheduleDto[];
const iso = (s: string) => new Date(s);

describe('schedule arithmetic (06:00 East Africa Time = 03:00 UTC)', () => {
  it('weekly: the next Monday, strictly in the future', () => {
    // 2026-11-20 is a Friday
    expect(nextRunAfter('WEEKLY', iso('2026-11-20T12:00:00Z')).toISOString()).toBe('2026-11-23T03:00:00.000Z');
    expect(nextRunAfter('WEEKLY', iso('2026-11-22T23:59:00Z')).toISOString()).toBe('2026-11-23T03:00:00.000Z'); // Sunday night
    expect(nextRunAfter('WEEKLY', iso('2026-11-23T02:59:00Z')).toISOString()).toBe('2026-11-23T03:00:00.000Z'); // Monday, before the run
    expect(nextRunAfter('WEEKLY', iso('2026-11-23T03:00:00Z')).toISOString()).toBe('2026-11-30T03:00:00.000Z'); // exactly at it: next week
    expect(nextRunAfter('WEEKLY', iso('2026-11-23T09:00:00Z')).toISOString()).toBe('2026-11-30T03:00:00.000Z');
    expect(nextRunAfter('WEEKLY', iso('2026-11-29T10:00:00Z')).getUTCDay()).toBe(1); // Sunday → Monday
  });

  it('monthly: the 1st of next month, across year ends', () => {
    expect(nextRunAfter('MONTHLY', iso('2026-11-20T12:00:00Z')).toISOString()).toBe('2026-12-01T03:00:00.000Z');
    expect(nextRunAfter('MONTHLY', iso('2026-12-15T12:00:00Z')).toISOString()).toBe('2027-01-01T03:00:00.000Z');
    expect(nextRunAfter('MONTHLY', iso('2026-12-01T02:00:00Z')).toISOString()).toBe('2026-12-01T03:00:00.000Z');
    expect(nextRunAfter('MONTHLY', iso('2026-12-01T03:00:00Z')).toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('every run is after the previous one and in the future, for any starting moment', () => {
    for (const f of ['WEEKLY', 'MONTHLY'] as const) {
      let t = iso('2026-01-01T00:00:00Z').getTime();
      for (let i = 0; i < 400; i++, t += 37 * H) {
        const after = new Date(t);
        const next = nextRunAfter(f, after);
        expect(next.getTime()).toBeGreaterThan(t);
        expect(next.getUTCHours()).toBe(3);
        if (f === 'WEEKLY') expect(next.getUTCDay()).toBe(1);
        else expect(next.getUTCDate()).toBe(1);
      }
    }
  });

  it('period: the week or month that ended at the run', () => {
    expect(periodFor('WEEKLY', iso('2026-11-23T03:00:00Z'))).toEqual({ from: iso('2026-11-16T03:00:00Z'), to: iso('2026-11-23T03:00:00Z') });
    expect(periodFor('MONTHLY', iso('2026-12-01T03:00:00Z'))).toEqual({ from: iso('2026-11-01T03:00:00Z'), to: iso('2026-12-01T03:00:00Z') });
    expect(periodFor('MONTHLY', iso('2027-01-01T03:00:00Z')).from.toISOString()).toBe('2026-12-01T03:00:00.000Z');
  });
});

describe('managing scheduled reports', () => {
  it('creates, lists, pauses, resumes and deletes, auditing each change', async () => {
    const res = await create({ type: 'GOVERNANCE_CSV', frequency: 'WEEKLY' }).expect(201);
    expect(res.body).toMatchObject({ type: 'GOVERNANCE_CSV', frequency: 'WEEKLY', enabled: true, lastRunAt: null, createdBy: ws.manager.name });
    expect(Date.parse(res.body.nextRunAt)).toBeGreaterThan(Date.now());
    expect((await list()).map((s) => s.id)).toContain(res.body.id);

    const paused = await request(app).patch(`/api/report-schedules/${res.body.id}`).set(as(ws.manager)).send({ enabled: false }).expect(200);
    expect(paused.body.enabled).toBe(false);
    // Resuming moves the next run to the future instead of firing for the time it was off.
    await prisma.reportSchedule.update({ where: { id: res.body.id }, data: { nextRunAt: new Date(Date.now() - 5 * 86_400_000) } });
    const resumed = await request(app).patch(`/api/report-schedules/${res.body.id}`).set(as(ws.manager)).send({ enabled: true }).expect(200);
    expect(Date.parse(resumed.body.nextRunAt)).toBeGreaterThan(Date.now());

    await request(app).delete(`/api/report-schedules/${res.body.id}`).set(as(ws.manager)).expect(204);
    expect((await list()).map((s) => s.id)).not.toContain(res.body.id);

    const actions = (await prisma.auditEvent.findMany({ where: { orgId: ws.orgId, resourceId: res.body.id }, orderBy: { id: 'asc' } })).map((e) => e.action);
    expect(actions).toEqual(['REPORT_SCHEDULE_CREATED', 'REPORT_SCHEDULE_PAUSED', 'REPORT_SCHEDULE_ENABLED', 'REPORT_SCHEDULE_DELETED']);
  });

  it.each([
    ['audit trail (not schedulable)', { type: 'AUDIT_CSV', frequency: 'WEEKLY' }],
    ['unknown frequency', { type: 'CASES_CSV', frequency: 'DAILY' }],
    ['missing type', { frequency: 'WEEKLY' }],
  ])('rejects %s', async (_l, body) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('the database itself refuses a scheduled audit export', async () => {
    await expect(
      prisma.reportSchedule.create({ data: { orgId: ws.orgId, type: 'AUDIT_CSV', frequency: 'WEEKLY', createdById: ws.manager.id, nextRunAt: new Date() } }),
    ).rejects.toThrow(/reportschedule_type_allowed/);
  });

  it('is limited to people who may export, and is invisible across organisations', async () => {
    for (const a of [ws.coordinator, ws.focalA]) {
      expect((await create({ type: 'CASES_CSV', frequency: 'MONTHLY' }, a)).status).toBe(403);
      await request(app).get('/api/report-schedules').set(as(a)).expect(403);
    }
    await create({ type: 'CASES_CSV', frequency: 'MONTHLY' }, ws.clinical).expect(201);
    const mine = await create({ type: 'CASES_CSV', frequency: 'WEEKLY' }).expect(201);
    const other = await makeWorkspace();
    expect((await list(other.manager)).map((s) => s.id)).not.toContain(mine.body.id);
    await request(app).patch(`/api/report-schedules/${mine.body.id}`).set(as(other.manager)).send({ enabled: false }).expect(404);
    await request(app).delete(`/api/report-schedules/${mine.body.id}`).set(as(other.manager)).expect(404);
    await request(app).get('/api/report-schedules').expect(401);
  });

  it('caps how many an organisation can hold', async () => {
    const w = await makeWorkspace();
    for (let i = 0; i < MAX_SCHEDULES_PER_ORG; i++) await create({ type: 'CASES_CSV', frequency: 'WEEKLY' }, w.manager).expect(201);
    const res = await create({ type: 'CASES_CSV', frequency: 'WEEKLY' }, w.manager);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOO_MANY_SCHEDULES');
  });
});

describe('running scheduled reports', () => {
  const due = async (w: Workspace, over: Record<string, unknown> = {}) =>
    prisma.reportSchedule.create({
      data: { orgId: w.orgId, type: 'GOVERNANCE_CSV', frequency: 'WEEKLY', createdById: w.manager.id, nextRunAt: new Date('2026-11-16T03:00:00Z'), ...over },
    });

  it('queues one export in the owner\'s name for the period that ended, then schedules the next run', async () => {
    const w = await makeWorkspace();
    const s = await due(w);
    const now = new Date('2026-11-16T03:00:30Z');
    expect(await runReportScheduler(now)).toBe(1);

    const jobs = await prisma.exportJob.findMany({ where: { orgId: w.orgId } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ type: 'GOVERNANCE_CSV', status: 'PENDING', requestedBy: w.manager.id });
    expect(jobs[0].params).toEqual({ from: '2026-11-09T03:00:00.000Z', to: '2026-11-16T03:00:00.000Z' });
    expect(jobs[0].fileName).toMatch(/^pathora-programme-performance-weekly-\d{8}-\d{4}\.csv$/);

    const after = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.lastRunAt).toEqual(now);
    expect(after.nextRunAt.toISOString()).toBe('2026-11-23T03:00:00.000Z');

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: w.orgId, resourceId: jobs[0].id, action: 'EXPORT_REQUESTED' } });
    expect(audit.actorRole).toContain('scheduled report');

    expect(await runReportScheduler(new Date('2026-11-16T03:01:00Z'))).toBe(0); // not due again
    expect(await prisma.exportJob.count({ where: { orgId: w.orgId } })).toBe(1);
  });

  it('two servers holding the same stale snapshot queue the report exactly once', async () => {
    const w = await makeWorkspace();
    const s = await due(w);
    const now = new Date('2026-11-16T03:00:30Z');
    // Both servers read the schedule as due before either acted on it.
    const snapshot = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: s.id }, include: { createdBy: true } });
    expect(await queueScheduledReport(snapshot, now)).toBe(true);
    expect(await queueScheduledReport(snapshot, now)).toBe(false);
    expect(await prisma.exportJob.count({ where: { orgId: w.orgId } })).toBe(1);
  });

  it('simultaneous scheduler runs never double-queue either', async () => {
    const w = await makeWorkspace();
    await due(w);
    const now = new Date('2026-11-16T03:00:30Z');
    await Promise.all([runReportScheduler(now), runReportScheduler(now), runReportScheduler(now), runReportScheduler(now)]);
    expect(await prisma.exportJob.count({ where: { orgId: w.orgId } })).toBe(1);
  });

  it('after downtime produces one catch-up report, not a backlog', async () => {
    const w = await makeWorkspace();
    const s = await due(w, { nextRunAt: new Date('2026-09-07T03:00:00Z') });
    expect(await runReportScheduler(new Date('2026-11-18T10:00:00Z'))).toBe(1);
    expect(await prisma.exportJob.count({ where: { orgId: w.orgId } })).toBe(1);
    expect((await prisma.reportSchedule.findUniqueOrThrow({ where: { id: s.id } })).nextRunAt.toISOString()).toBe('2026-11-23T03:00:00.000Z');
  });

  it('skips paused schedules and ones not yet due', async () => {
    const w = await makeWorkspace();
    await due(w, { enabled: false });
    await due(w, { nextRunAt: new Date('2026-12-01T03:00:00Z') });
    expect(await runReportScheduler(new Date('2026-11-16T04:00:00Z'))).toBe(0);
    expect(await prisma.exportJob.count({ where: { orgId: w.orgId } })).toBe(0);
  });

  it('pauses (and says so in the audit trail) when the owner can no longer export', async () => {
    const w = await makeWorkspace();
    const s = await due(w, { createdById: w.coordinator.id }); // a role without exports.create
    expect(await runReportScheduler(new Date('2026-11-16T04:00:00Z'))).toBe(0);
    expect((await prisma.reportSchedule.findUniqueOrThrow({ where: { id: s.id } })).enabled).toBe(false);
    expect(await prisma.exportJob.count({ where: { orgId: w.orgId } })).toBe(0);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: w.orgId, resourceId: s.id, action: 'REPORT_SCHEDULE_PAUSED' } });
    expect(ev.detail).toContain('no longer has access');

    const s2 = await due(w, { createdById: w.manager.id });
    await prisma.user.update({ where: { id: w.manager.id }, data: { active: false } });
    expect(await runReportScheduler(new Date('2026-11-16T04:00:00Z'))).toBe(0);
    expect((await prisma.reportSchedule.findUniqueOrThrow({ where: { id: s2.id } })).enabled).toBe(false);
  });
});

describe('programme performance report', () => {
  let w: Workspace;
  beforeAll(async () => {
    w = await makeWorkspace();
    const a1 = await createCase(w, { patientName: 'Zuberi Mwangi' });
    await advance(w, a1.id, 'closed');
    const a2 = await createCase(w, { patientName: 'Yusufu Otieno' });
    await advance(w, a2.id, 'ack');
    const b1 = await createCase(w, { pathway: 'NCD_SCREENING', facilityId: w.facilityB.id, patientName: 'Xavier Kiplagat' });
    await act(w.coordinator, b1.id, 'escalate', { reason: 'Unreachable' }).expect(200);
    await createCase(w, { pathway: 'NCD_SCREENING', facilityId: w.facilityB.id, patientName: 'Waweru Njuguna' });
  });

  async function generate(params: object = {}) {
    const res = await request(app).post('/api/exports').set(as(w.manager)).send({ type: 'GOVERNANCE_CSV', ...params }).expect(202);
    await processPending();
    const job = (await request(app).get(`/api/exports/${res.body.id}`).set(as(w.manager)).expect(200)).body;
    expect(job.status).toBe('READY');
    const raw = (await request(app).get(job.downloadUrl).expect(200)).text;
    return { job, rows: parse(raw.replace(/^﻿/, ''), { columns: true }) as Record<string, string>[], raw };
  }

  it('has the documented columns, per-facility rows, pathway subtotals and a programme total', async () => {
    const { rows, raw } = await generate();
    expect(raw.replace(/^﻿/, '').split('\n')[0].trim()).toBe(GOVERNANCE_COLUMNS.join(','));
    const key = (r: Record<string, string>) => `${r.Pathway} | ${r.Facility}`;
    const byKey = Object.fromEntries(rows.map((r) => [key(r), r]));
    expect(Object.keys(byKey)).toEqual([
      `Cancer Screening | ${w.facilityA.name}`, 'Cancer Screening | All facilities',
      `NCD Screening | ${w.facilityB.name}`, 'NCD Screening | All facilities',
      'All pathways | All facilities',
    ]);
    expect(byKey[`Cancer Screening | ${w.facilityA.name}`]).toMatchObject({ Referrals: '2', 'Facility Acknowledged': '2', 'Patient Attended': '1', 'Closed Verified': '1', 'Completion Rate %': '50', 'Overdue SLA': '0' });
    expect(byKey[`NCD Screening | ${w.facilityB.name}`]).toMatchObject({ Referrals: '2', 'Facility Acknowledged': '0', 'Closed Verified': '0', 'Overdue SLA': '1' });
    expect(byKey['All pathways | All facilities']).toMatchObject({ Referrals: '4', 'Closed Verified': '1', 'Overdue SLA': '1', 'Completion Rate %': '25' });
  });

  it('agrees with the dashboard numbers for the same programme', async () => {
    const { rows } = await generate();
    const total = rows.find((r) => r.Pathway === 'All pathways')!;
    const o = (await request(app).get('/api/metrics/overview').set(as(w.manager)).expect(200)).body as OverviewMetricsDto;
    expect(Number(total.Referrals)).toBe(o.total);
    expect(Number(total['Closed Verified'])).toBe(o.statusCounts.closedVerified);
    expect(Number(total['Overdue SLA'])).toBe(o.statusCounts.overdueSla);
    expect(Number(total['Completion Rate %'])).toBe(o.completionRate);
    expect(total['Median Hours To Acknowledge']).toBe(o.medianHoursToAcknowledge === null ? '' : String(o.medianHoursToAcknowledge));
    expect(total['Median Hours To Close']).toBe(o.medianHoursToClose === null ? '' : String(o.medianHoursToClose));
  });

  it('contains no patient names, codes or reference numbers', async () => {
    const { raw } = await generate();
    for (const needle of ['Zuberi', 'Yusufu', 'Xavier', 'Waweru', 'PT-', 'REF-']) expect(raw).not.toContain(needle);
  });

  it('honours the date range, and an empty range still yields a total row of zeros', async () => {
    const { rows } = await generate({ from: new Date(Date.now() + 365 * 24 * H).toISOString() });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ Pathway: 'All pathways', Referrals: '0', 'Completion Rate %': '0', 'Median Hours To Acknowledge': '' });
  });

  it('a scheduled run produces a downloadable report end to end', async () => {
    await prisma.reportSchedule.create({ data: { orgId: w.orgId, type: 'GOVERNANCE_CSV', frequency: 'MONTHLY', createdById: w.manager.id, nextRunAt: new Date(Date.now() - 1000) } });
    expect(await runReportScheduler()).toBe(1);
    await processPending();
    const jobs = (await request(app).get('/api/exports').set(as(w.manager)).expect(200)).body.exports as Array<{ type: string; status: string; fileName: string; downloadUrl: string | null }>;
    const scheduled = jobs.find((j) => j.fileName.includes('-monthly-'))!;
    expect(scheduled).toMatchObject({ type: 'GOVERNANCE_CSV', status: 'READY' });
    expect((await request(app).get(scheduled.downloadUrl!).expect(200)).text).toContain('All pathways');
  });
});

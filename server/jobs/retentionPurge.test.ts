import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditVerifyResponse, OverviewMetricsDto } from '../../shared/types';
import { aad, decryptField } from '../lib/crypto';
import { ERASED_NAME } from '../modules/privacy/erase';
import { prisma } from '../test/helpers';
import { advance, app, as, createCase, makeWorkspace, type Workspace } from '../test/workspace';
import { runRetentionPurge } from './retentionPurge';

const DAY = 86_400_000;
let ws: Workspace;
beforeAll(async () => {
  ws = await makeWorkspace();
});
afterAll(() => prisma.$disconnect());

const erased = async (code: string, w = ws) => (await prisma.patient.findFirstOrThrow({ where: { orgId: w.orgId, patientCode: code } })).erasedAt !== null;
const closedDaysAgo = async (w: Workspace, days: number, name = 'Retention Patient') => {
  const c = await createCase(w, { patientName: name });
  await advance(w, c.id, 'closed');
  await prisma.referralCase.updateMany({ where: { orgId: w.orgId, refNumber: c.id }, data: { closedAt: new Date(Date.now() - days * DAY) } });
  return c;
};
/**
 * Runs the purge for just the given organisations: every other organisation's window is parked far in the future for the
 * duration of the run (and always restored), so other test files' organisations are neither touched nor affected.
 */
const purgeOnly = async (ids: string[], now = new Date()) => {
  const others = await prisma.organization.findMany({ where: { id: { notIn: ids } }, select: { id: true, retentionDays: true } });
  await prisma.organization.updateMany({ where: { id: { notIn: ids } }, data: { retentionDays: 36_500 } });
  try {
    return await runRetentionPurge(now);
  } finally {
    await Promise.all(others.map((o) => prisma.organization.update({ where: { id: o.id }, data: { retentionDays: o.retentionDays } })));
  }
};
const purge = (w: Workspace, now?: Date) => purgeOnly([w.orgId], now);

describe('retention purge', () => {
  it('erases people whose every referral closed longer ago than the window, and nobody else', async () => {
    const w = await makeWorkspace();
    await prisma.organization.update({ where: { id: w.orgId }, data: { retentionDays: 90 } });

    const old = await closedDaysAgo(w, 120, 'Old Closed');
    const recent = await closedDaysAgo(w, 30, 'Recent Closed');
    const edge = await closedDaysAgo(w, 89, 'Just Inside');
    const open = await createCase(w, { patientName: 'Still Open' });
    await prisma.referralCase.updateMany({ where: { orgId: w.orgId, refNumber: open.id }, data: { issuedAt: new Date(Date.now() - 200 * DAY), slaDueAt: new Date(Date.now() - 190 * DAY) } });

    const summary = await purge(w);
    expect(summary).toMatchObject({ patientsErased: 1, errors: 0 });
    expect(await erased(old.patientCode, w)).toBe(true);
    expect(await erased(recent.patientCode, w)).toBe(false);
    expect(await erased(edge.patientCode, w)).toBe(false);
    expect(await erased(open.patientCode, w)).toBe(false);

    const p = await prisma.patient.findFirstOrThrow({ where: { orgId: w.orgId, patientCode: old.patientCode } });
    expect(decryptField(p.nameEnc, aad.patientName(w.orgId))).toBe(ERASED_NAME);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: w.orgId, action: 'PATIENT_DATA_ERASED' } });
    expect(ev).toMatchObject({ actorId: null, actorLabel: 'Retention job', actorRole: 'System', resourceId: old.patientCode });
    expect(ev.detail).toContain('retention window of 90 days');
    expect(ev.detail).not.toContain('Old Closed');
  });

  it('a person with one old closed referral and one recent one is kept (the newest decides)', async () => {
    const w = await makeWorkspace();
    await prisma.organization.update({ where: { id: w.orgId }, data: { retentionDays: 90 } });
    const first = await closedDaysAgo(w, 400, 'Two Referrals');
    const p = await prisma.patient.findFirstOrThrow({ where: { orgId: w.orgId, patientCode: first.patientCode } });
    const row = await prisma.referralCase.findFirstOrThrow({ where: { orgId: w.orgId, refNumber: first.id } });
    await prisma.referralCase.create({
      data: { refNumber: 'REF-7777-0001', orgId: w.orgId, patientId: p.id, pathway: 'NCD_SCREENING', rulePackId: row.rulePackId, sourceProgram: 'x', coordinatorId: w.coordinator.id, facilityId: w.facilityA.id, stage: 'CLOSED', issuedAt: new Date(Date.now() - 20 * DAY), slaDueAt: new Date(Date.now() - 10 * DAY), dueDate: new Date(), closedAt: new Date(Date.now() - 10 * DAY), closureReason: 'Done', outcomeSource: 'Dr X' },
    });
    expect((await purge(w)).patientsErased).toBe(0);
    expect(await erased(first.patientCode, w)).toBe(false);
  });

  it('applies each organisation\'s own window', async () => {
    const short = await makeWorkspace();
    const long = await makeWorkspace();
    await prisma.organization.update({ where: { id: short.orgId }, data: { retentionDays: 30 } });
    await prisma.organization.update({ where: { id: long.orgId }, data: { retentionDays: 730 } });
    const a = await closedDaysAgo(short, 60);
    const b = await closedDaysAgo(long, 60);
    await purgeOnly([short.orgId, long.orgId]); // both organisations in one run
    expect(await erased(a.patientCode, short)).toBe(true);
    expect(await erased(b.patientCode, long)).toBe(false);
  });

  it('is idempotent, leaves referral statistics and the audit chain intact', async () => {
    const w = await makeWorkspace();
    await prisma.organization.update({ where: { id: w.orgId }, data: { retentionDays: 90 } });
    await closedDaysAgo(w, 200);
    await closedDaysAgo(w, 300);
    const before = (await request(app).get('/api/metrics/overview').set(as(w.manager)).expect(200)).body as OverviewMetricsDto;

    expect((await purge(w)).patientsErased).toBe(2);
    expect((await purge(w)).patientsErased).toBe(0);
    expect(await prisma.auditEvent.count({ where: { orgId: w.orgId, action: 'PATIENT_DATA_ERASED' } })).toBe(2);

    const after = (await request(app).get('/api/metrics/overview').set(as(w.manager)).expect(200)).body as OverviewMetricsDto;
    expect(after.total).toBe(before.total);
    expect(after.statusCounts).toEqual(before.statusCounts);
    expect(after.medianHoursToClose).toBe(before.medianHoursToClose);
    const v = (await request(app).get('/api/audit/verify').set(as(w.dpo)).expect(200)).body as AuditVerifyResponse;
    expect(v.ok, JSON.stringify(v)).toBe(true);
  });

  it('removes stale login-throttle and replay-key rows but not fresh ones', async () => {
    const w = await makeWorkspace();
    const old = new Date(Date.now() - 10 * DAY);
    await prisma.loginAttempt.createMany({ data: [{ keyHash: 'old'.padEnd(64, '0'), createdAt: old }, { keyHash: 'new'.padEnd(64, '0') }] });
    await prisma.idempotencyKey.create({ data: { orgId: w.orgId, userId: w.manager.id, key: 'k'.repeat(16), requestHash: 'h', createdAt: new Date(Date.now() - 5 * DAY) } });
    const s = await purge(w);
    expect(s.housekeeping).toBeGreaterThanOrEqual(2);
    expect(await prisma.loginAttempt.count({ where: { keyHash: 'old'.padEnd(64, '0') } })).toBe(0);
    expect(await prisma.loginAttempt.count({ where: { keyHash: 'new'.padEnd(64, '0') } })).toBe(1);
  });
});

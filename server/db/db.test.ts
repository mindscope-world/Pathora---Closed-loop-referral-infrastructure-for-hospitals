import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from './client';
import { nextRefNumber, formatRefNumber } from '../lib/ids';
import { computeAuditHash, GENESIS_HASH } from '../lib/auditHash';
import { appendAudit, verifyAuditChain } from '../modules/audit/append';
import { aad, encryptField } from '../lib/crypto';

let orgId: string;
let facilityId: string;
let userId: string;
let rulePackId: string;
let patientId: string;

const audit = (detail: string) => ({
  orgId, actorId: null, actorLabel: 'Test', actorRole: 'Tester', action: 'TEST',
  resourceType: 'ReferralCase', resourceId: 'REF-TEST', detail,
});

beforeAll(async () => {
  // Fresh tenant per run; the audit table is append-only so we cannot (and should not) clean it up.
  const org = await prisma.organization.create({ data: { name: `Test org ${Date.now()}` } });
  orgId = org.id;
  facilityId = (await prisma.facility.create({
    data: { orgId, name: 'F', type: 'PUBLIC_REFERRAL', city: 'Nairobi', interopMethod: 'PORTAL_CSV' },
  })).id;
  userId = (await prisma.user.create({
    data: { orgId, email: `u${Date.now()}@test.example`, passwordHash: 'x', name: 'U', role: 'PROGRAMME_COORDINATOR', accessScope: 's' },
  })).id;
  rulePackId = (await prisma.rulePack.create({
    data: { orgId, key: 'RP-T', pathway: 'CANCER_SCREENING', name: 'T', version: 1, status: 'ACTIVE', ackSlaHours: 24, contactSlaHours: 12, evalTargetDays: 7, redFlagRule: 'r', closureCriteria: 'c' },
  })).id;
  patientId = (await prisma.patient.create({
    data: { orgId, patientCode: 'PT-T1', nameEnc: encryptField('Test Patient', aad.patientName(orgId)), label: 'l' },
  })).id;
});

afterAll(() => prisma.$disconnect());

let seq = 0;
function caseData(over: Record<string, unknown> = {}) {
  const issuedAt = new Date('2026-11-19T08:00:00Z');
  return {
    refNumber: `REF-9999-${String(++seq).padStart(4, '0')}${Date.now() % 100000}`, orgId, patientId, pathway: 'CANCER_SCREENING' as const, rulePackId,
    sourceProgram: 's', coordinatorId: userId, facilityId, stage: 'HANDOFF_SENT' as const,
    issuedAt, slaDueAt: new Date(issuedAt.getTime() + 24 * 3_600_000), dueDate: issuedAt, ...over,
  };
}

describe('reference numbers', () => {
  it('formats REF-YYYY-NNNN', () => {
    expect(formatRefNumber(2026, 7)).toBe('REF-2026-0007');
    expect(formatRefNumber(2026, 12345)).toBe('REF-2026-12345');
  });

  it('issues unique consecutive numbers under concurrency', async () => {
    const nums = await Promise.all(
      Array.from({ length: 25 }, () => prisma.$transaction((tx) => nextRefNumber(tx, orgId, 2099))),
    );
    expect(new Set(nums).size).toBe(25);
    expect(nums.map((n) => Number(n.split('-')[2])).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('does not burn a number when the surrounding transaction rolls back', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await nextRefNumber(tx, orgId, 2098);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.$transaction((tx) => nextRefNumber(tx, orgId, 2098))).toBe('REF-2098-0001');
  });

  it('keeps sequences separate per year', async () => {
    expect(await prisma.$transaction((tx) => nextRefNumber(tx, orgId, 2097))).toBe('REF-2097-0001');
    expect(await prisma.$transaction((tx) => nextRefNumber(tx, orgId, 2096))).toBe('REF-2096-0001');
  });
});

describe('audit trail', () => {
  it('chains events and verifies, including under concurrent appends', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => prisma.$transaction((tx) => appendAudit(tx, audit(`event ${i}`)))));
    const events = await prisma.auditEvent.findMany({ where: { orgId }, orderBy: { id: 'asc' } });
    expect(events).toHaveLength(10);
    expect(events[0].prevHash).toBe(GENESIS_HASH);
    events.slice(1).forEach((e, i) => expect(e.prevHash).toBe(events[i].hash));
    expect(await verifyAuditChain(prisma, orgId)).toEqual({ ok: true, count: 10 });
  });

  it('rolls the audit record back with the audited change', async () => {
    const before = await prisma.auditEvent.count({ where: { orgId } });
    await expect(
      prisma.$transaction(async (tx) => {
        await appendAudit(tx, audit('will roll back'));
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    expect(await prisma.auditEvent.count({ where: { orgId } })).toBe(before);
  });

  it('is append-only: UPDATE, DELETE and TRUNCATE are rejected by the database', async () => {
    await prisma.$transaction((tx) => appendAudit(tx, audit('immutable')));
    await expect(prisma.auditEvent.updateMany({ where: { orgId }, data: { detail: 'rewritten' } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.deleteMany({ where: { orgId } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE "AuditEvent"')).rejects.toThrow(/append-only/);
  });

  it('verification detects a forged event inserted with a bad hash', async () => {
    const forgedOrg = await prisma.organization.create({ data: { name: `Forged ${Date.now()}` } });
    const at = new Date();
    const good = { orgId: forgedOrg.id, at, actorId: null, actorLabel: 'x', actorRole: 'x', action: 'A', resourceType: 'T', resourceId: 'R', detail: 'ok' };
    await prisma.auditEvent.create({ data: { ...good, prevHash: GENESIS_HASH, hash: computeAuditHash(GENESIS_HASH, good) } });
    const forged = await prisma.auditEvent.create({
      data: { ...good, detail: 'forged', prevHash: computeAuditHash(GENESIS_HASH, good), hash: 'a'.repeat(64) },
    });
    expect(await verifyAuditChain(prisma, forgedOrg.id)).toMatchObject({ ok: false, brokenAtId: forged.id });
  });

  it('rejects malformed hashes at the schema level', async () => {
    await expect(
      prisma.auditEvent.create({ data: { ...audit('bad'), prevHash: GENESIS_HASH, hash: 'not-a-hash' } }),
    ).rejects.toThrow();
  });
});

describe('integrity constraints', () => {
  it('cannot close a case without a documented, attributed outcome', async () => {
    await expect(prisma.referralCase.create({ data: caseData({ stage: 'CLOSED' }) })).rejects.toThrow();
    await expect(
      prisma.referralCase.create({ data: caseData({ stage: 'CLOSED', closedAt: new Date(), closureReason: 'done' }) }),
    ).rejects.toThrow();
    await expect(
      prisma.referralCase.create({
        data: caseData({ stage: 'CLOSED', closedAt: new Date(), closureReason: 'done', outcomeSource: 'Dr X' }),
      }),
    ).resolves.toBeTruthy();
  });

  it('rejects an SLA deadline before the issue time', async () => {
    const issuedAt = new Date('2026-11-19T08:00:00Z');
    await expect(
      prisma.referralCase.create({ data: caseData({ issuedAt, slaDueAt: new Date(issuedAt.getTime() - 1) }) }),
    ).rejects.toThrow();
  });

  it('requires a facility for facility-focal users', async () => {
    await expect(
      prisma.user.create({ data: { orgId, email: `f${Date.now()}@test.example`, passwordHash: 'x', name: 'F', role: 'FACILITY_FOCAL', accessScope: 's' } }),
    ).rejects.toThrow();
  });

  it('rejects non-positive SLAs', async () => {
    await expect(
      prisma.rulePack.create({
        data: { orgId, key: 'RP-BAD', pathway: 'NCD_SCREENING', name: 'B', version: 1, status: 'ACTIVE', ackSlaHours: 0, contactSlaHours: 1, evalTargetDays: 1, redFlagRule: 'r', closureCriteria: 'c' },
      }),
    ).rejects.toThrow();
  });

  it('rejects ciphertext shorter than the envelope header', async () => {
    await expect(
      prisma.patient.create({ data: { orgId, patientCode: 'PT-BAD', nameEnc: new Uint8Array(5), label: 'l' } }),
    ).rejects.toThrow();
  });

  it('keeps consent append-only', async () => {
    const row = await prisma.consent.create({ data: { patientId, channel: 'SMS', granted: true, lawfulBasis: 'test' } });
    await expect(prisma.consent.update({ where: { id: row.id }, data: { granted: false } })).rejects.toThrow(/append-only/);
    await expect(prisma.consent.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it('enforces unique milestones per case and unique patient codes per org', async () => {
    const c = await prisma.referralCase.create({ data: caseData() });
    const m = { caseId: c.id, type: 'REFERRAL_ISSUED' as const, occurredAt: new Date() };
    await prisma.caseMilestone.create({ data: m });
    await expect(prisma.caseMilestone.create({ data: m })).rejects.toThrow();
    await expect(
      prisma.patient.create({ data: { orgId, patientCode: 'PT-T1', nameEnc: encryptField('Dup', 'x'), label: 'l' } }),
    ).rejects.toThrow();
  });
});

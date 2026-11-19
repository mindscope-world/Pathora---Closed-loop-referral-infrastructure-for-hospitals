import { PATHWAY_LABELS, STAGE_LABELS, STATUS_LABELS } from '../../../shared/types';
import { prisma } from '../../db/client';
import type { Prisma } from '../../db/generated/client';
import { csvRow, type CsvValue } from '../../lib/csv';
import { consentState } from '../cases/dto';
import { deriveStatus, slaHoursRemaining } from '../cases/sla';

/** Receives rows; the worker backs it with a file. */
export interface Sink {
  row(values: CsvValue[]): Promise<void>;
}
export const sinkFor = (write: (chunk: string) => Promise<void>): Sink => ({ row: (v) => write(csvRow(v)) });

export interface ExportParams {
  from?: string;
  to?: string;
}
export interface GenerateContext {
  orgId: string;
  params: ExportParams;
  now: Date;
}
export interface GenerateResult {
  rowCount: number;
  /** Audit exports only: hash of the last event included. */
  chainTip?: string;
}

const BATCH = 500;
const range = (p: ExportParams) => ({
  ...(p.from ? { gte: new Date(p.from) } : {}),
  ...(p.to ? { lte: new Date(p.to) } : {}),
});

export const CASE_COLUMNS = [
  'Case ID', 'Patient Code', 'Pathway', 'Source Program', 'Coordinator', 'Receiving Facility', 'Stage', 'Status',
  'Red Flag', 'Opted Out', 'Referral Issued', 'Facility Ack', 'Patient Attended', 'Evaluation Completed',
  'Outcome Documented', 'Next SLA Deadline', 'Hours To Deadline', 'Closure Reason', 'Outcome Source',
] as const;

/**
 * One row per referral. Patient NAMES are deliberately not exported: reports for funders and
 * committees identify patients by their programme code only. All timestamps are ISO-8601 UTC.
 * Status/SLA are computed at generation time, exactly as the dashboard computes them.
 */
export async function generateCasesCsv(ctx: GenerateContext, sink: Sink): Promise<GenerateResult> {
  await sink.row([...CASE_COLUMNS]);
  const where: Prisma.ReferralCaseWhereInput = {
    orgId: ctx.orgId,
    isSynthetic: false,
    ...(ctx.params.from || ctx.params.to ? { issuedAt: range(ctx.params) } : {}),
  };

  let cursor: string | undefined;
  let rowCount = 0;
  for (;;) {
    const rows = await prisma.referralCase.findMany({
      where,
      orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        patient: { select: { patientCode: true, consent: { select: { channel: true, granted: true, event: true, recordedAt: true } } } },
        coordinator: { select: { name: true } },
        facility: { select: { name: true } },
        milestones: true,
      },
    });
    if (rows.length === 0) break;

    for (const c of rows) {
      const at = (type: string) => c.milestones.find((m) => m.type === type)?.occurredAt;
      const hasAck = Boolean(at('FACILITY_ACKNOWLEDGED'));
      const closed = c.stage === 'CLOSED';
      const consent = consentState([...c.patient.consent].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime()));
      await sink.row([
        c.refNumber, c.patient.patientCode, PATHWAY_LABELS[c.pathway], c.sourceProgram, c.coordinator.name, c.facility.name,
        STAGE_LABELS[c.stage], STATUS_LABELS[deriveStatus({ stage: c.stage, hasAcknowledged: hasAck, slaDueAt: c.slaDueAt }, ctx.now)],
        c.redFlag, consent.optedOut,
        at('REFERRAL_ISSUED'), at('FACILITY_ACKNOWLEDGED'), at('PATIENT_ATTENDED'), at('EVALUATION_COMPLETED'), at('OUTCOME_DOCUMENTED'),
        closed ? null : c.slaDueAt, closed ? null : slaHoursRemaining({ stage: c.stage, slaDueAt: c.slaDueAt }, ctx.now),
        c.closureReason, c.outcomeSource,
      ]);
      rowCount++;
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }
  return { rowCount };
}

export const AUDIT_COLUMNS = [
  'Event ID', 'Organisation ID', 'Timestamp', 'Actor ID', 'Actor', 'Role', 'Action', 'Resource Type', 'Resource ID', 'Detail',
  'Previous Hash', 'Hash',
] as const;

/**
 * The audit trail with each event's `Previous Hash` and `Hash`, so a recipient can recompute the
 * chain themselves: hash = SHA-256(previous hash + "\n" + canonical JSON of {orgId, at, actorId,
 * actorLabel, actorRole, action, resourceType, resourceId, detail}), see server/lib/auditHash.ts.
 * Every hashed field is a column here, which is what makes the file self-verifying.
 * (One caveat: a text cell that would start with = + - @ carries a leading ' added for
 * spreadsheet safety; strip it before hashing.)
 * The set is fixed at the moment generation starts: events written while the file is being produced
 * are not included, and `chainTip` records exactly where the export ends.
 */
export async function generateAuditCsv(ctx: GenerateContext, sink: Sink): Promise<GenerateResult> {
  await sink.row([...AUDIT_COLUMNS]);
  const newest = await prisma.auditEvent.findFirst({ where: { orgId: ctx.orgId }, orderBy: { id: 'desc' }, select: { id: true } });
  if (!newest) return { rowCount: 0 };

  const where: Prisma.AuditEventWhereInput = {
    orgId: ctx.orgId,
    id: { lte: newest.id },
    ...(ctx.params.from || ctx.params.to ? { at: range(ctx.params) } : {}),
  };
  let after: bigint | undefined;
  let rowCount = 0;
  let chainTip: string | undefined;
  for (;;) {
    const rows = await prisma.auditEvent.findMany({
      where: after === undefined ? where : { AND: [where, { id: { gt: after } }] },
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    if (rows.length === 0) break;
    for (const e of rows) {
      await sink.row([String(e.id), e.orgId, e.at, e.actorId, e.actorLabel, e.actorRole, e.action, e.resourceType, e.resourceId, e.detail, e.prevHash, e.hash]);
      rowCount++;
      chainTip = e.hash;
    }
    after = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }
  return { rowCount, chainTip };
}

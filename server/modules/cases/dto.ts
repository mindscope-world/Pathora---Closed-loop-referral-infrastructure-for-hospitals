import type { Prisma } from '../../db/generated/client';
import type { CaseDto, CaseMilestonesDto } from '../../../shared/types';
import { aad, decryptField } from '../../lib/crypto';
import { deriveStatus, slaHoursRemaining } from './sla';

/** Everything `toCaseDto` needs, loaded in one query. */
export const caseInclude = {
  patient: { include: { consent: { orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }] } } },
  coordinator: { select: { id: true, name: true } },
  facility: { select: { id: true, name: true } },
  milestones: true,
  rulePack: true,
} satisfies Prisma.ReferralCaseInclude;

export type CaseRow = Prisma.ReferralCaseGetPayload<{ include: typeof caseInclude }>;

type ConsentRow = Pick<CaseRow['patient']['consent'][number], 'channel' | 'granted' | 'event' | 'recordedAt'>;

/**
 * Consent is append-only rows; current state is derived.
 *  - per-channel flags: the latest row for that channel
 *  - opted out: the newest OPTED_OUT is more recent than the newest RESTORED
 */
export function consentState(rows: ConsentRow[]) {
  const latest = (channel: ConsentRow['channel']) => rows.find((r) => r.channel === channel); // rows are newest-first
  const newest = (event: ConsentRow['event']) =>
    rows.filter((r) => r.event === event).reduce<number>((max, r) => Math.max(max, r.recordedAt.getTime()), -Infinity);
  return {
    consentSms: latest('SMS')?.granted ?? false,
    consentWhatsApp: latest('WHATSAPP')?.granted ?? false,
    optedOut: newest('OPTED_OUT') > newest('RESTORED'),
  };
}

const MILESTONE_KEYS: Record<string, keyof CaseMilestonesDto> = {
  REFERRAL_ISSUED: 'referralIssuedAt',
  FACILITY_ACKNOWLEDGED: 'facilityAcknowledgedAt',
  PATIENT_ATTENDED: 'patientAttendedAt',
  EVALUATION_COMPLETED: 'evaluationCompletedAt',
  OUTCOME_DOCUMENTED: 'outcomeDocumentedAt',
};

export const hasMilestone = (row: Pick<CaseRow, 'milestones'>, type: string) => row.milestones.some((m) => m.type === type);

export function toCaseDto(row: CaseRow, now: Date): CaseDto {
  const milestones: CaseMilestonesDto = {};
  for (const m of row.milestones) milestones[MILESTONE_KEYS[m.type]] = m.occurredAt.toISOString();

  const hasAcknowledged = hasMilestone(row, 'FACILITY_ACKNOWLEDGED');
  const closed = row.stage === 'CLOSED';
  return {
    id: row.refNumber,
    patientCode: row.patient.patientCode,
    patientName: decryptField(row.patient.nameEnc, aad.patientName(row.orgId)),
    patientLabel: row.patient.label,
    pathway: row.pathway,
    sourceProgram: row.sourceProgram,
    coordinator: row.coordinator,
    facility: row.facility,
    stage: row.stage,
    status: deriveStatus({ stage: row.stage, hasAcknowledged, slaDueAt: row.slaDueAt }, now),
    ...consentState(row.patient.consent),
    createdAt: row.createdAt.toISOString(),
    dueDate: row.dueDate.toISOString(),
    slaDueAt: closed ? null : row.slaDueAt.toISOString(),
    slaHoursRemaining: slaHoursRemaining({ stage: row.stage, slaDueAt: row.slaDueAt }, now),
    redFlag: row.redFlag,
    notes: row.notes,
    closureReason: row.closureReason,
    outcomeSource: row.outcomeSource,
    milestones,
    version: row.version,
  };
}

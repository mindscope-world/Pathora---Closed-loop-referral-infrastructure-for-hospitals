import { PATHWAY_LABELS, type CaseDto, type CaseStage, type CaseStatus as ApiCaseStatus, type FacilityDto } from '../../shared/types';
import type {
  CaseMilestones,
  CaseStage as ViewStage,
  CaseStatus as ViewStatus,
  FacilityPartner,
  PathwayName,
  ReferralCase,
} from './dashboardData';

/**
 * The dashboard views were built against display-string types (`'Handoff Sent'`, `'2026-11-17 09:15'`).
 * The API speaks enums and ISO timestamps. This is the one place that translates, so the views
 * stay unchanged and the API stays clean.
 */

const STAGE: Record<CaseStage, ViewStage> = {
  INTAKE: 'Intake',
  ASSIGNED: 'Assigned',
  CONTACTED: 'Contacted',
  HANDOFF_SENT: 'Handoff Sent',
  ACKNOWLEDGED: 'Acknowledged',
  ATTENDED: 'Attended',
  ESCALATED: 'Escalated',
  CLOSED: 'Closed',
};

const STATUS: Record<ApiCaseStatus, ViewStatus> = {
  ACTIVE: 'Active',
  AWAITING_ACK: 'Awaiting Ack',
  OVERDUE_SLA: 'Overdue SLA',
  CLOSED_VERIFIED: 'Closed Verified',
};

const FACILITY_TYPE: Record<FacilityDto['type'], FacilityPartner['type']> = {
  PUBLIC_REFERRAL: 'Public Referral',
  FAITH_BASED: 'Faith-Based',
  PRIVATE_SPECIALIST: 'Private Specialist',
  COUNTY_DIAGNOSTIC: 'County Diagnostic',
};

const INTEROP: Record<FacilityDto['interopMethod'], FacilityPartner['interopMethod']> = {
  PORTAL_CSV: 'Portal + CSV',
  API_READY: 'API Ready',
  STATUS_RETURN_DESK: 'Status-Return Desk',
};

const TZ = 'Africa/Nairobi';
const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function parts(iso: string) {
  const out: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(new Date(iso))) out[p.type] = p.value;
  return out;
}

/** 'YYYY-MM-DD HH:mm' in East Africa Time: the format the dashboard has always displayed. */
export function formatDateTime(iso: string): string {
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export function formatDate(iso: string): string {
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

function milestones(m: CaseDto['milestones']): CaseMilestones {
  const fmt = (v?: string) => (v ? formatDateTime(v) : undefined);
  return {
    referralIssuedAt: fmt(m.referralIssuedAt) ?? '',
    facilityAcknowledgedAt: fmt(m.facilityAcknowledgedAt),
    patientAttendedAt: fmt(m.patientAttendedAt),
    evaluationCompletedAt: fmt(m.evaluationCompletedAt),
    outcomeDocumentedAt: fmt(m.outcomeDocumentedAt),
  };
}

export function toViewCase(c: CaseDto): ReferralCase {
  return {
    id: c.id,
    patientCode: c.patientCode,
    patientName: c.patientName,
    patientLabel: c.patientLabel,
    pathway: PATHWAY_LABELS[c.pathway] as PathwayName,
    sourceProgram: c.sourceProgram,
    coordinator: c.coordinator.name,
    receivingFacility: c.facility.name,
    stage: STAGE[c.stage],
    status: STATUS[c.status],
    consentSms: c.consentSms,
    consentWhatsApp: c.consentWhatsApp,
    optedOut: c.optedOut,
    createdAt: formatDateTime(c.createdAt),
    dueDate: formatDate(c.dueDate),
    slaHoursRemaining: c.slaHoursRemaining,
    redFlag: c.redFlag,
    notes: c.notes,
    closureReason: c.closureReason ?? undefined,
    outcomeSource: c.outcomeSource ?? undefined,
    milestones: milestones(c.milestones),
    coordinatorId: c.coordinator.id,
    facilityId: c.facility.id,
    version: c.version,
  };
}

export function toViewFacility(f: FacilityDto): FacilityPartner {
  return {
    id: f.id,
    name: f.name,
    type: FACILITY_TYPE[f.type],
    city: f.city,
    focalPerson: f.focalPerson ?? '—',
    interopMethod: INTEROP[f.interopMethod],
    avgAckHours: f.avgAckHours === null ? 0 : Math.round(f.avgAckHours),
  };
}

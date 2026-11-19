/**
 * Types shared between the Vite frontend (src/) and the Express backend (server/).
 * Keep this file free of runtime imports from either side.
 */

export interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

// ───────────────────────────── Auth ─────────────────────────────

export type UserRole =
  | 'PROGRAMME_MANAGER'
  | 'PROGRAMME_COORDINATOR'
  | 'FACILITY_FOCAL'
  | 'CLINICAL_LEAD'
  | 'DPO';

/** Display names used by the UI (match the labels the dashboard has always shown). */
export const ROLE_LABELS: Record<UserRole, string> = {
  PROGRAMME_MANAGER: 'Programme Manager',
  PROGRAMME_COORDINATOR: 'Programme Coordinator',
  FACILITY_FOCAL: 'Receiving Facility Focal',
  CLINICAL_LEAD: 'Partner Clinical Lead',
  DPO: 'Data Protection Contact',
};

export interface AuthUserDto {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  affiliation: string | null;
  facilityId: string | null;
  organization: { id: string; name: string };
}

export interface SignupRequest {
  fullName: string;
  organization: string;
  email: string;
  password: string;
  /** Primary pathway of interest; informational only. */
  pathway?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthSessionResponse {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: AuthUserDto;
}

// ───────────────────────────── Referral cases ─────────────────────────────

export type PathwayId =
  | 'CANCER_SCREENING'
  | 'NCD_SCREENING'
  | 'MALE_REPRODUCTIVE_HEALTH'
  | 'MATERNAL_CHILD_HEALTH';

export type CaseStage =
  | 'INTAKE'
  | 'ASSIGNED'
  | 'CONTACTED'
  | 'HANDOFF_SENT'
  | 'ACKNOWLEDGED'
  | 'ATTENDED'
  | 'ESCALATED'
  | 'CLOSED';

/** Derived on read from stage + SLA deadline (never stored). */
export type CaseStatus = 'ACTIVE' | 'AWAITING_ACK' | 'OVERDUE_SLA' | 'CLOSED_VERIFIED';

export interface CaseMilestonesDto {
  referralIssuedAt?: string;
  facilityAcknowledgedAt?: string;
  patientAttendedAt?: string;
  evaluationCompletedAt?: string;
  outcomeDocumentedAt?: string;
}

/** All timestamps are ISO-8601 UTC strings. */
export interface CaseDto {
  /** Human-facing id, e.g. REF-2026-0418. Used in URLs. */
  id: string;
  patientCode: string;
  patientName: string;
  patientLabel: string;
  pathway: PathwayId;
  sourceProgram: string;
  coordinator: { id: string; name: string };
  facility: { id: string; name: string };
  stage: CaseStage;
  status: CaseStatus;
  consentSms: boolean;
  consentWhatsApp: boolean;
  optedOut: boolean;
  createdAt: string;
  /** Target date for a documented outcome (issued + the pathway's evaluation target). */
  dueDate: string;
  /** Deadline for the next required action; null once closed. */
  slaDueAt: string | null;
  /** Hours until `slaDueAt` (negative = overdue); 0 once closed. */
  slaHoursRemaining: number;
  redFlag: boolean;
  notes: string;
  closureReason: string | null;
  outcomeSource: string | null;
  milestones: CaseMilestonesDto;
  /** Optimistic-lock counter; send back as `expectedVersion` to detect concurrent edits. */
  version: number;
}

export interface AuditEventDto {
  /** Monotonic per-chain sequence number (string: it can exceed JS's safe integer range). */
  id: string;
  at: string;
  actor: string;
  role: string;
  action: string;
  resourceType: string;
  resourceId: string;
  detail: string;
  /** This event's place in the tamper-evident chain. */
  hash: string;
}
/** Case timeline entries are the same events. */
export type AuditEntryDto = AuditEventDto;

export interface CommsEntryDto {
  id: string;
  channel: 'SMS' | 'WHATSAPP' | 'VOICE';
  templateName: string;
  status: string;
  sentAt: string;
}

export interface CaseDetailDto extends CaseDto {
  timeline: AuditEntryDto[];
  comms: CommsEntryDto[];
}

export interface CaseListResponse {
  cases: CaseDto[];
  nextCursor: string | null;
}

export interface FacilityDto {
  id: string;
  name: string;
  type: 'PUBLIC_REFERRAL' | 'FAITH_BASED' | 'PRIVATE_SPECIALIST' | 'COUNTY_DIAGNOSTIC';
  city: string;
  interopMethod: 'PORTAL_CSV' | 'API_READY' | 'STATUS_RETURN_DESK';
  focalPerson: string | null;
  /** Mean hours from referral issued to facility acknowledgment; null until there is data. */
  avgAckHours: number | null;
}

export interface AssigneeDto {
  id: string;
  name: string;
  role: UserRole;
}

export interface CreateCaseRequest {
  /** Required unless `patientCode` is given (then defaults to "Patient <code>"). */
  patientName?: string;
  /** Optional: generated (PT-NNNN) when omitted. */
  patientCode?: string;
  patientLabel?: string;
  pathway: PathwayId;
  sourceProgram: string;
  coordinatorId: string;
  facilityId: string;
  redFlag?: boolean;
  /** Patient has consented to SMS follow-up (recorded as a consent event). */
  consentSms?: boolean;
  notes?: string;
}

export interface CaseActionRequest {
  /** If set and stale, the server answers 409 instead of overwriting a newer change. */
  expectedVersion?: number;
}
export interface CloseCaseRequest extends CaseActionRequest {
  closureReason: string;
  /** Defaults to "<you> (<facility>)". */
  outcomeSource?: string;
}
export interface EscalateCaseRequest extends CaseActionRequest {
  reason: string;
}
export interface BarrierResolutionRequest extends CaseActionRequest {
  note: string;
}
export interface ReassignCaseRequest extends CaseActionRequest {
  coordinatorId: string;
}

export interface ImportCasesRequest {
  /** CSV text: patientCode, cohortLabel, pathway, sourceProgram, owner, facility[, patientName]. */
  csv: string;
  /** Validate and report only; write nothing. */
  dryRun?: boolean;
  /** The programme attests it holds the patients' consent for SMS follow-up. Required to import. */
  consentAttested?: boolean;
}
export interface ImportRowResult {
  /** 1-based line number in the submitted CSV. */
  line: number;
  patientCode: string;
  ok: boolean;
  caseId?: string;
  error?: string;
}
export interface ImportCasesResponse {
  dryRun: boolean;
  imported: number;
  rejected: number;
  rows: ImportRowResult[];
}

export const PATHWAY_LABELS: Record<PathwayId, string> = {
  CANCER_SCREENING: 'Cancer Screening',
  NCD_SCREENING: 'NCD Screening',
  MALE_REPRODUCTIVE_HEALTH: 'Male Reproductive Health',
  MATERNAL_CHILD_HEALTH: 'Maternal & Child Health',
};

export const STAGE_LABELS: Record<CaseStage, string> = {
  INTAKE: 'Intake',
  ASSIGNED: 'Assigned',
  CONTACTED: 'Contacted',
  HANDOFF_SENT: 'Handoff Sent',
  ACKNOWLEDGED: 'Acknowledged',
  ATTENDED: 'Attended',
  ESCALATED: 'Escalated',
  CLOSED: 'Closed',
};

export const STATUS_LABELS: Record<CaseStatus, string> = {
  ACTIVE: 'Active',
  AWAITING_ACK: 'Awaiting Ack',
  OVERDUE_SLA: 'Overdue SLA',
  CLOSED_VERIFIED: 'Closed Verified',
};

// ───────────────────────────── Audit & exports ─────────────────────────────

export interface AuditListResponse {
  events: AuditEventDto[];
  nextCursor: string | null;
}

export interface AuditVerifyResponse {
  /** true when every event's hash and link to its predecessor check out. */
  ok: boolean;
  /** Events checked (up to the first problem). */
  count: number;
  /** Hash of the newest event: record it externally to later prove nothing before it changed. */
  tipHash: string | null;
  verifiedAt: string;
  brokenAtId?: string;
  reason?: string;
}

export type ExportType = 'CASES_CSV' | 'AUDIT_CSV';
export type ExportStatus = 'PENDING' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED';

export const EXPORT_LABELS: Record<ExportType, string> = {
  CASES_CSV: 'Live Referral Cohort CSV',
  AUDIT_CSV: 'Immutable Audit Trail CSV',
};

export interface CreateExportRequest {
  type: ExportType;
  /** Optional ISO-8601 bounds (inclusive): referral issue time for cases, event time for audit. */
  from?: string;
  to?: string;
}

export interface ExportJobDto {
  id: string;
  type: ExportType;
  status: ExportStatus;
  fileName: string;
  requestedBy: string;
  requestedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  rowCount: number | null;
  byteSize: number | null;
  sha256: string | null;
  chainTip: string | null;
  error: string | null;
  /** Short-lived signed link; present only while the job is READY. Each fetch of the job mints a fresh one. */
  downloadUrl: string | null;
}

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

export interface AuditEntryDto {
  id: string;
  at: string;
  actor: string;
  role: string;
  action: string;
  detail: string;
}

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

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
  /** A mobile number is on file for the patient (the number itself is never returned). */
  hasPhone: boolean;
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
  /** Patient's mobile number (any common Kenyan format). Stored encrypted. */
  patientPhone?: string;
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
  /** CSV text: patientCode, cohortLabel, pathway, sourceProgram, owner, facility[, patientName[, mobileNumber]]. */
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

export type ExportType = 'CASES_CSV' | 'AUDIT_CSV' | 'GOVERNANCE_CSV';
export type ExportStatus = 'PENDING' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED';

export const EXPORT_LABELS: Record<ExportType, string> = {
  CASES_CSV: 'Live Referral Cohort CSV',
  AUDIT_CSV: 'Immutable Audit Trail CSV',
  GOVERNANCE_CSV: 'Programme Performance Summary CSV',
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

// ───────────────────────────── Team, organisation, facilities ─────────────────────────────

/** Plain-language access description shown beside each role (and stored on the user when they join). */
export const ROLE_SCOPES: Record<UserRole, string> = {
  PROGRAMME_MANAGER: 'Owns programme configuration, referrals, team access and exports',
  PROGRAMME_COORDINATOR: 'Coordinates active referral follow-up & SLA queues',
  FACILITY_FOCAL: 'Acknowledges referrals & returns authorized outcome data',
  CLINICAL_LEAD: 'Approves pathway rules, red flags & closure criteria',
  DPO: 'Audits consent logs, access history & retention policies',
};

export interface TeamMemberDto {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** Free-text site/organisation label. */
  affiliation: string | null;
  facility: { id: string; name: string } | null;
  accessScope: string;
  active: boolean;
  lastLoginAt: string | null;
  /** Referrals this person currently owns that are not yet closed (reassign these before deactivating). */
  openCases: number;
}

export interface InviteDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  facility: { id: string; name: string } | null;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  status: 'PENDING' | 'EXPIRED';
}

export interface TeamResponse {
  members: TeamMemberDto[];
  invites: InviteDto[];
}

export interface InviteRequest {
  email: string;
  name: string;
  role: UserRole;
  /** Required when role is FACILITY_FOCAL. */
  facilityId?: string;
}

export interface InviteCreatedResponse {
  invite: InviteDto;
  /** Single-use link the invitee follows to choose a password. Shown once: only a hash is stored. */
  inviteUrl: string;
  /** Whether an email was sent. When false, the inviter shares the link themselves. */
  emailed: boolean;
}

export interface UpdateMemberRequest {
  active?: boolean;
  role?: UserRole;
  facilityId?: string | null;
  name?: string;
}

export interface InviteLookupResponse {
  email: string;
  name: string;
  role: UserRole;
  organization: string;
  invitedBy: string;
  expiresAt: string;
}

export interface AcceptInviteRequest {
  token: string;
  password: string;
  /** Lets the invitee correct the name the inviter typed. */
  name?: string;
}

export interface OrganizationDto {
  id: string;
  name: string;
  dpoContact: string | null;
  /** Programme support number, substituted for {phone} in patient messages. */
  supportPhone: string | null;
  retentionDays: number;
  createdAt: string;
}

export interface UpdateOrganizationRequest {
  name?: string;
  dpoContact?: string | null;
  supportPhone?: string | null;
  retentionDays?: number;
}

export interface FacilityInput {
  name: string;
  type: FacilityDto['type'];
  city: string;
  interopMethod: FacilityDto['interopMethod'];
}

// ───────────────────────────── Rule packs, SLA monitor, notifications ─────────────────────────────

export type RulePackStatus = 'ACTIVE' | 'CONFIGURED' | 'COMING_SOON';

/** The machine-readable red-flag rule the SLA monitor enforces. */
export interface RedFlagPolicy {
  /**
   * Escalate a red-flagged referral to a human if the receiving facility has not acknowledged it within
   * this many hours of issue. null = no timer (the pathway routes red flags by other means).
   */
  unacknowledgedHours: number | null;
}

export interface RulePackDto {
  /** Stable key (e.g. RP-CANCER); identifies the pack across its versions. */
  id: string;
  name: string;
  pathway: PathwayId;
  version: number;
  status: RulePackStatus;
  ackSlaHours: number;
  contactSlaHours: number;
  evalTargetDays: number;
  clinicalOwner: { id: string; name: string } | null;
  /** Wording written by the clinical owner, shown to people. */
  redFlagRule: string;
  /** What the monitor enforces. */
  redFlagPolicy: RedFlagPolicy;
  closureCriteria: string;
  effectiveFrom: string;
}

export interface RulePackListResponse {
  rulePacks: RulePackDto[];
  /** Active clinical leads who can be named as a pack's clinical owner. */
  clinicalLeads: Array<{ id: string; name: string }>;
}

export interface RulePackVersionDto extends RulePackDto {
  /** Who approved this version (null for the initial, seeded version). */
  editedBy: string | null;
}

export interface UpdateRulePackRequest {
  ackSlaHours?: number;
  contactSlaHours?: number;
  evalTargetDays?: number;
  redFlagRule?: string;
  redFlagPolicy?: RedFlagPolicy;
  closureCriteria?: string;
  clinicalOwnerId?: string | null;
  status?: RulePackStatus;
  /** If set and stale, the server answers 409 instead of overwriting a newer version. */
  expectedVersion?: number;
}

export interface SyntheticCheck {
  id: string;
  title: string;
  outcome: 'PASSED' | 'FAILED' | 'SKIPPED';
  detail: string;
}

export interface SyntheticTestResponse {
  rulePack: { id: string; name: string; version: number };
  ranAt: string;
  /** true when no check FAILED (skipped checks do not fail a run). */
  passed: boolean;
  checks: SyntheticCheck[];
}

export interface NotificationDto {
  id: string;
  kind: string;
  title: string;
  body: string;
  caseRef: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsResponse {
  notifications: NotificationDto[];
  unread: number;
}

/** Referral cases that need attention: overdue, escalated, red-flagged, or due within about 12 hours. */
export const ESCALATION_WINDOW_HOURS = 12;

// ───────────────────────────── Patient communications ─────────────────────────────

export type MessagingChannelId = 'SMS' | 'WHATSAPP';
export type LanguageId = 'ENGLISH' | 'KISWAHILI';
export type TemplateStatus = 'DRAFT' | 'APPROVED' | 'RETIRED';

export const LANGUAGE_LABELS: Record<LanguageId, string> = { ENGLISH: 'English', KISWAHILI: 'Kiswahili' };
export const CHANNEL_LABELS: Record<MessagingChannelId | 'VOICE', string> = { SMS: 'SMS', WHATSAPP: 'WhatsApp', VOICE: 'Voice Call' };

export interface TemplateDto {
  id: string;
  name: string;
  /** null = usable for any pathway. */
  pathway: PathwayId | null;
  channel: MessagingChannelId;
  language: LanguageId;
  body: string;
  /** Only APPROVED templates can be sent. Editing the wording returns a template to DRAFT. */
  status: TemplateStatus;
  reviewedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  /** Placeholders the wording uses, e.g. ["facility", "phone"]. */
  placeholders: string[];
}

export interface TemplateInput {
  name: string;
  pathway: PathwayId | null;
  channel: MessagingChannelId;
  language: LanguageId;
  body: string;
}

export type DeliveryStatusId = 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'BLOCKED_OPTOUT' | 'HUMAN_ROUTED';

export interface CommsLogDto {
  id: string;
  /** Referral number the message belongs to. */
  caseId: string;
  patientCode: string;
  channel: MessagingChannelId | 'VOICE';
  templateName: string;
  status: DeliveryStatusId;
  requestedAt: string;
  /** When the provider accepted it; null until then. */
  sentAt: string | null;
  /** For QUEUED messages: when it will be tried (later than now during quiet hours or between retries). */
  scheduledFor: string | null;
  failureReason: string | null;
  attempts: number;
}

export interface CommsLogResponse {
  entries: CommsLogDto[];
  nextCursor: string | null;
}

export interface SendMessageRequest {
  templateId: string;
  channel: MessagingChannelId;
}

export interface SendMessageResponse {
  entry: CommsLogDto;
  /** true = queued for delivery. false = refused or handed to a person (see `message`). */
  accepted: boolean;
  message: string;
}

export interface UpdateContactRequest {
  /** Mobile number in any common Kenyan format, or null to remove it. */
  phone: string | null;
}

export interface UpdateConsentRequest {
  channel: MessagingChannelId;
  granted: boolean;
}


// ───────────────────────────── Metrics and scheduled reports ─────────────────────────────

/** Funnel steps, cumulative: a case counts in every step its stage has reached. Shared so the UI and the API agree. */
export const FUNNEL_STEPS: ReadonlyArray<{ key: string; label: string; stages: readonly CaseStage[] }> = [
  { key: 'INTAKE_ASSIGNED', label: '1. Intake & Assigned', stages: ['INTAKE', 'ASSIGNED', 'CONTACTED', 'HANDOFF_SENT', 'ACKNOWLEDGED', 'ATTENDED', 'ESCALATED', 'CLOSED'] },
  { key: 'HANDOFF_SENT', label: '2. Facility Handoff Sent', stages: ['HANDOFF_SENT', 'ACKNOWLEDGED', 'ATTENDED', 'ESCALATED', 'CLOSED'] },
  { key: 'ACKNOWLEDGED', label: '3. Facility Acknowledged', stages: ['ACKNOWLEDGED', 'ATTENDED', 'CLOSED'] },
  { key: 'ATTENDED', label: '4. Patient Attended', stages: ['ATTENDED', 'CLOSED'] },
  { key: 'CLOSED', label: '5. Verified Outcome Closed', stages: ['CLOSED'] },
];

export interface FunnelStepDto {
  key: string;
  label: string;
  count: number;
  /** Share of all referrals, rounded to a whole number. */
  percent: number;
}

export interface PathwayMetricsDto {
  pathway: PathwayId;
  cases: number;
  /** Facility has acknowledged (a milestone, so it stays true after the case moves on). */
  acknowledged: number;
  closedVerified: number;
}

export interface OverviewMetricsDto {
  asOf: string;
  total: number;
  statusCounts: { active: number; awaitingAck: number; overdueSla: number; closedVerified: number };
  /** Everything not yet closed with a verified outcome. */
  activeReferrals: number;
  /** Open referrals the facility has taken on (or that are late): waiting on a clinical endpoint. */
  pendingCareCompletions: number;
  attendedAwaitingOutcome: number;
  /** Closed-verified share of all referrals, whole percent. */
  completionRate: number;
  funnel: FunnelStepDto[];
  pathways: PathwayMetricsDto[];
  /** Hours from referral issue to facility acknowledgement (median), null when nothing has been acknowledged. */
  medianHoursToAcknowledge: number | null;
  /** Hours from referral issue to documented outcome (median) over closed referrals. */
  medianHoursToClose: number | null;
  acknowledgedSample: number;
  closedSample: number;
}

export interface UpcomingMetricsDto {
  asOf: string;
  /** Start of today in East Africa Time, as an instant. */
  windowStart: string;
  /** All matching referrals (the list below may be shorter). */
  count: number;
  cases: CaseDto[];
}

export type ReportType = 'CASES_CSV' | 'GOVERNANCE_CSV';
export type ReportFrequency = 'WEEKLY' | 'MONTHLY';

export interface ReportScheduleDto {
  id: string;
  type: ReportType;
  frequency: ReportFrequency;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdBy: string;
}

export interface CreateReportScheduleRequest {
  type: ReportType;
  frequency: ReportFrequency;
}
export interface UpdateReportScheduleRequest {
  enabled: boolean;
}

// ───────────────────────────── Facility integrations ─────────────────────────────

export type ApiKeyScopeId = 'referrals:read' | 'referrals:identify' | 'status:write';

export interface FacilityApiKeyDto {
  id: string;
  name: string;
  /** Public identifier (`pk_<id>`), safe to show; the secret is never retrievable after creation. */
  keyPrefix: string;
  scopes: ApiKeyScopeId[];
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface CreateApiKeyRequest {
  name: string;
  scopes: ApiKeyScopeId[];
  /** Optional lifetime; omit for a key that stays valid until revoked. */
  expiresInDays?: number;
}

/** Returned once, at creation. Store both values now: they cannot be shown again. */
export interface CreatedApiKeyResponse extends FacilityApiKeyDto {
  apiKey: string;
  signingSecret: string;
}

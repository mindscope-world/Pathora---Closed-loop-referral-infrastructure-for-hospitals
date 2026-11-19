export type CaseStage =
  | 'Intake'
  | 'Assigned'
  | 'Contacted'
  | 'Handoff Sent'
  | 'Acknowledged'
  | 'Attended'
  | 'Escalated'
  | 'Closed';

export type CaseStatus = 'Active' | 'Awaiting Ack' | 'Overdue SLA' | 'Closed Verified';

export type PathwayName = 'Cancer Screening' | 'NCD Screening' | 'Male Reproductive Health';

export interface CaseMilestones {
  referralIssuedAt: string;
  facilityAcknowledgedAt?: string;
  patientAttendedAt?: string;
  evaluationCompletedAt?: string;
  outcomeDocumentedAt?: string;
}

export interface ReferralCase {
  id: string;
  patientCode: string;
  patientName: string;
  patientLabel: string;
  pathway: PathwayName;
  sourceProgram: string;
  coordinator: string;
  receivingFacility: string;
  stage: CaseStage;
  status: CaseStatus;
  consentSms: boolean;
  consentWhatsApp: boolean;
  optedOut: boolean;
  createdAt: string;
  dueDate: string;
  slaHoursRemaining: number;
  redFlag: boolean;
  notes: string;
  closureReason?: string;
  outcomeSource?: string;
  milestones: CaseMilestones;
  /** Present on cases loaded from the API; used to address mutations. */
  coordinatorId?: string;
  facilityId?: string;
  /** Optimistic-lock version from the server. */
  version?: number;
}

export interface FacilityPartner {
  id: string;
  name: string;
  type: 'Public Referral' | 'Faith-Based' | 'Private Specialist' | 'County Diagnostic';
  city: string;
  focalPerson: string;
  interopMethod: 'Portal + CSV' | 'API Ready' | 'Status-Return Desk';
  avgAckHours: number;
  /** API enum values, present on facilities loaded from the server (used by the edit form). */
  typeId?: 'PUBLIC_REFERRAL' | 'FAITH_BASED' | 'PRIVATE_SPECIALIST' | 'COUNTY_DIAGNOSTIC';
  interopId?: 'PORTAL_CSV' | 'API_READY' | 'STATUS_RETURN_DESK';
}

export interface MessageTemplate {
  id: string;
  name: string;
  pathway: PathwayName | 'All Pathways';
  channel: 'SMS' | 'WhatsApp';
  language: 'English' | 'Kiswahili';
  body: string;
  reviewedBy: string;
}

export interface CommsLogEntry {
  id: string;
  caseId: string;
  patientCode: string;
  channel: 'SMS' | 'WhatsApp' | 'Voice Call';
  templateName: string;
  deliveryStatus: 'Delivered' | 'Read' | 'Blocked (Opt-out)' | 'Human Routed';
  timestamp: string;
}

export interface PathwayRulePack {
  id: string;
  name: string;
  version: string;
  status: 'Active' | 'Configured' | 'Coming Soon';
  ackSlaHours: number;
  contactSlaHours: number;
  evalTargetDays: number;
  clinicalOwner: string;
  redFlagRule: string;
  closureCriteria: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  role: string;
  action: string;
  resourceId: string;
  detail: string;
}

export const INITIAL_FACILITIES: FacilityPartner[] = [
  {
    id: 'FAC-01',
    name: 'Kenyatta Referral Outpatient Desk',
    type: 'Public Referral',
    city: 'Nairobi',
    focalPerson: 'Sr. Beatrice Muthoni',
    interopMethod: 'API Ready',
    avgAckHours: 14,
  },
  {
    id: 'FAC-02',
    name: 'St. Luke Mission Diagnostic Centre',
    type: 'Faith-Based',
    city: 'Nakuru',
    focalPerson: 'Dr. Daniel Kiprop',
    interopMethod: 'Portal + CSV',
    avgAckHours: 19,
  },
  {
    id: 'FAC-03',
    name: 'Kisumu County Specialty Clinic',
    type: 'County Diagnostic',
    city: 'Kisumu',
    focalPerson: 'Grace Atieno, RN',
    interopMethod: 'Status-Return Desk',
    avgAckHours: 22,
  },
  {
    id: 'FAC-04',
    name: 'Pwani Regional Care Hospital',
    type: 'Private Specialist',
    city: 'Mombasa',
    focalPerson: 'Dr. Hassan Bakari',
    interopMethod: 'API Ready',
    avgAckHours: 11,
  },
];

export const INITIAL_CASES: ReferralCase[] = [
  {
    id: 'REF-2026-0418',
    patientCode: 'PT-8841',
    patientName: 'Jane Wambui',
    patientLabel: 'Cohort NBO · F / 44',
    pathway: 'Cancer Screening',
    sourceProgram: 'Nairobi Mobile Cervical Screening',
    coordinator: 'Miriam Wanjiku',
    receivingFacility: 'Kenyatta Referral Outpatient Desk',
    stage: 'Acknowledged',
    status: 'Active',
    consentSms: true,
    consentWhatsApp: true,
    optedOut: false,
    createdAt: '2026-11-17 09:15',
    dueDate: '2026-11-20',
    slaHoursRemaining: 18,
    redFlag: true,
    notes: 'High-priority confirmatory colposcopy requested by clinical lead.',
    milestones: {
      referralIssuedAt: '2026-11-17 09:20',
      facilityAcknowledgedAt: '2026-11-17 16:40',
    },
  },
  {
    id: 'REF-2026-0419',
    patientCode: 'PT-8842',
    patientName: 'Samuel Otieno',
    patientLabel: 'Cohort KSM · M / 52',
    pathway: 'NCD Screening',
    sourceProgram: 'Kisumu CHP Hypertension Drive',
    coordinator: 'Peter Omondi',
    receivingFacility: 'Kisumu County Specialty Clinic',
    stage: 'Handoff Sent',
    status: 'Overdue SLA',
    consentSms: true,
    consentWhatsApp: false,
    optedOut: false,
    createdAt: '2026-11-15 11:05',
    dueDate: '2026-11-18',
    slaHoursRemaining: -14,
    redFlag: false,
    notes: 'Facility acknowledgment exceeded 48h SLA. Transport barrier reported by patient.',
    milestones: {
      referralIssuedAt: '2026-11-15 11:30',
    },
  },
  {
    id: 'REF-2026-0420',
    patientCode: 'PT-8843',
    patientName: 'Faith Chebet',
    patientLabel: 'Cohort NKR · F / 39',
    pathway: 'Cancer Screening',
    sourceProgram: 'Rift Valley Community Breast Screen',
    coordinator: 'Miriam Wanjiku',
    receivingFacility: 'St. Luke Mission Diagnostic Centre',
    stage: 'Attended',
    status: 'Active',
    consentSms: true,
    consentWhatsApp: true,
    optedOut: false,
    createdAt: '2026-11-14 08:40',
    dueDate: '2026-11-19',
    slaHoursRemaining: 6,
    redFlag: false,
    notes: 'Patient attended diagnostic ultrasound; awaiting authorized outcome summary.',
    milestones: {
      referralIssuedAt: '2026-11-14 09:00',
      facilityAcknowledgedAt: '2026-11-14 17:15',
      patientAttendedAt: '2026-11-18 10:25',
    },
  },
  {
    id: 'REF-2026-0421',
    patientCode: 'PT-8844',
    patientName: 'Joseph Mwangi',
    patientLabel: 'Cohort MBA · M / 36',
    pathway: 'Male Reproductive Health',
    sourceProgram: 'Coastal Private Health Desk',
    coordinator: 'Amina Salim',
    receivingFacility: 'Pwani Regional Care Hospital',
    stage: 'Closed',
    status: 'Closed Verified',
    consentSms: false,
    consentWhatsApp: true,
    optedOut: false,
    createdAt: '2026-11-10 14:20',
    dueDate: '2026-11-16',
    slaHoursRemaining: 0,
    redFlag: false,
    notes: 'Discreet WhatsApp flow completed; urology consultation documented.',
    closureReason: 'Clinical evaluation completed & care plan initiated',
    outcomeSource: 'Dr. Hassan Bakari (Pwani Regional Care Hospital)',
    milestones: {
      referralIssuedAt: '2026-11-10 14:35',
      facilityAcknowledgedAt: '2026-11-10 18:10',
      patientAttendedAt: '2026-11-14 09:45',
      evaluationCompletedAt: '2026-11-14 11:00',
      outcomeDocumentedAt: '2026-11-14 15:20',
    },
  },
  {
    id: 'REF-2026-0422',
    patientCode: 'PT-8845',
    patientName: 'Esther Njoki',
    patientLabel: 'Cohort NBO · F / 58',
    pathway: 'NCD Screening',
    sourceProgram: 'Nairobi Workplace Metabolic Screen',
    coordinator: 'Peter Omondi',
    receivingFacility: 'Kenyatta Referral Outpatient Desk',
    stage: 'Handoff Sent',
    status: 'Awaiting Ack',
    consentSms: true,
    consentWhatsApp: true,
    optedOut: false,
    createdAt: '2026-11-18 15:10',
    dueDate: '2026-11-21',
    slaHoursRemaining: 29,
    redFlag: false,
    notes: 'Elevated HbA1c risk signal routed for confirmatory metabolic clinic review.',
    milestones: {
      referralIssuedAt: '2026-11-18 15:40',
    },
  },
  {
    id: 'REF-2026-0423',
    patientCode: 'PT-8846',
    patientName: 'Lucy Akinyi',
    patientLabel: 'Cohort NBO · F / 49',
    pathway: 'Cancer Screening',
    sourceProgram: 'Nairobi Mobile Cervical Screening',
    coordinator: 'Miriam Wanjiku',
    receivingFacility: 'Kenyatta Referral Outpatient Desk',
    stage: 'Closed',
    status: 'Closed Verified',
    consentSms: true,
    consentWhatsApp: false,
    optedOut: false,
    createdAt: '2026-11-08 10:00',
    dueDate: '2026-11-14',
    slaHoursRemaining: 0,
    redFlag: false,
    notes: 'Full closed-loop cycle completed within 5 days.',
    closureReason: 'Diagnostic biopsy negative · Returned to routine screening',
    outcomeSource: 'Sr. Beatrice Muthoni (Kenyatta Referral Desk)',
    milestones: {
      referralIssuedAt: '2026-11-08 10:30',
      facilityAcknowledgedAt: '2026-11-08 17:00',
      patientAttendedAt: '2026-11-12 08:50',
      evaluationCompletedAt: '2026-11-12 12:15',
      outcomeDocumentedAt: '2026-11-13 09:10',
    },
  },
  {
    id: 'REF-2026-0424',
    patientCode: 'PT-8847',
    patientName: 'Brian Kiprono',
    patientLabel: 'Cohort KSM · M / 41',
    pathway: 'NCD Screening',
    sourceProgram: 'Kisumu CHP Hypertension Drive',
    coordinator: 'Amina Salim',
    receivingFacility: 'Kisumu County Specialty Clinic',
    stage: 'Escalated',
    status: 'Overdue SLA',
    consentSms: true,
    consentWhatsApp: false,
    optedOut: true,
    createdAt: '2026-11-14 13:00',
    dueDate: '2026-11-17',
    slaHoursRemaining: -32,
    redFlag: true,
    notes: 'Patient opted out of SMS; escalated for direct human coordinator outreach.',
    milestones: {
      referralIssuedAt: '2026-11-14 13:45',
      facilityAcknowledgedAt: '2026-11-15 09:20',
    },
  },
];

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: 'TPL-01',
    name: 'Discreet Next-Step Check-In (EN)',
    pathway: 'All Pathways',
    channel: 'SMS',
    language: 'English',
    body: 'Hello, this is your care coordinator from the screening team. Your follow-up slot is ready at {facility}. Reply 1 to confirm or call {phone} for support.',
    reviewedBy: 'Clinical & Community Advisory Panel',
  },
  {
    id: 'TPL-02',
    name: 'Mwongozo wa Miadi ya Kliniki (SW)',
    pathway: 'Cancer Screening',
    channel: 'WhatsApp',
    language: 'Kiswahili',
    body: 'Habari, hili ni kumbusho la siri kuhusu miadi yako ya ufuatiliaji katika {facility}. Jibu NDIYO kuthibitisha au wasiliana nasi kwa msaada wa usafiri.',
    reviewedBy: 'Clinical & Community Advisory Panel',
  },
  {
    id: 'TPL-03',
    name: 'NCD Confirmatory Assessment Prompt',
    pathway: 'NCD Screening',
    channel: 'SMS',
    language: 'English',
    body: 'Reminder: please visit {facility} within 48 hours for your confirmatory check-up. No clinical details are shared in this message.',
    reviewedBy: 'Partner Clinical Lead',
  },
  {
    id: 'TPL-04',
    name: 'Private Specialist Portal Access',
    pathway: 'Male Reproductive Health',
    channel: 'WhatsApp',
    language: 'English',
    body: 'Your private follow-up summary is ready. Tap your secure link to view next steps or choose a preferred clinic time.',
    reviewedBy: 'Cultural & Community Adviser',
  },
];

export const INITIAL_COMMS_LOG: CommsLogEntry[] = [
  {
    id: 'MSG-901',
    caseId: 'REF-2026-0418',
    patientCode: 'PT-8841',
    channel: 'WhatsApp',
    templateName: 'Mwongozo wa Miadi ya Kliniki (SW)',
    deliveryStatus: 'Read',
    timestamp: '2026-11-17 10:05',
  },
  {
    id: 'MSG-902',
    caseId: 'REF-2026-0419',
    patientCode: 'PT-8842',
    channel: 'SMS',
    templateName: 'NCD Confirmatory Assessment Prompt',
    deliveryStatus: 'Delivered',
    timestamp: '2026-11-15 12:10',
  },
  {
    id: 'MSG-903',
    caseId: 'REF-2026-0424',
    patientCode: 'PT-8847',
    channel: 'Voice Call',
    templateName: 'Human Coordinator Barrier Check',
    deliveryStatus: 'Blocked (Opt-out)',
    timestamp: '2026-11-16 09:30',
  },
];

export const INITIAL_RULE_PACKS: PathwayRulePack[] = [
  {
    id: 'RP-CANCER',
    name: 'Cancer Screening Pathway',
    version: 'v2.1',
    status: 'Active',
    ackSlaHours: 24,
    contactSlaHours: 12,
    evalTargetDays: 7,
    clinicalOwner: 'Dr. Grace Njeri (Partner Clinical Lead)',
    redFlagRule: 'Immediate human coordinator escalation if high-grade lesion signal unacknowledged > 24h.',
    closureCriteria: 'Authorized colposcopy, biopsy, or specialist evaluation documented by receiving facility.',
  },
  {
    id: 'RP-NCD',
    name: 'NCD Screening Pathway (Hypertension & Diabetes)',
    version: 'v1.4',
    status: 'Active',
    ackSlaHours: 48,
    contactSlaHours: 24,
    evalTargetDays: 10,
    clinicalOwner: 'Dr. Samuel Korir (Partner Clinical Lead)',
    redFlagRule: 'Route severe hypertensive reading signals directly to human coordinator within 4 hours.',
    closureCriteria: 'Confirmatory clinic attendance and baseline care plan recorded.',
  },
  {
    id: 'RP-MALE',
    name: 'Male Reproductive Health Pathway',
    version: 'v1.0',
    status: 'Configured',
    ackSlaHours: 48,
    contactSlaHours: 24,
    evalTargetDays: 14,
    clinicalOwner: 'Dr. Hassan Bakari (Urology Adviser)',
    redFlagRule: 'Acute presentation flags route strictly to partner-approved emergency contact protocol.',
    closureCriteria: 'Private specialist evaluation completed and consented terminal status logged.',
  },
  {
    id: 'RP-MCH',
    name: 'Maternal & Child Health Pathway',
    version: 'Planned',
    status: 'Coming Soon',
    ackSlaHours: 12,
    contactSlaHours: 6,
    evalTargetDays: 3,
    clinicalOwner: 'Pending Partner Clinical Governance Sign-Off',
    redFlagRule: 'Multi-level obstetric escalation rules under clinical review.',
    closureCriteria: 'Multi-tier facility handoff and maternal/neonatal evaluation documented.',
  },
];

export const INITIAL_AUDIT_EVENTS: AuditEvent[] = [
  {
    id: 'AUD-501',
    timestamp: '2026-11-18 15:40',
    actor: 'Peter Omondi',
    role: 'Programme Coordinator',
    action: 'REFERRAL_ISSUED',
    resourceId: 'REF-2026-0422',
    detail: 'Issued NCD confirmatory referral to Kenyatta Referral Outpatient Desk.',
  },
  {
    id: 'AUD-502',
    timestamp: '2026-11-18 10:25',
    actor: 'Dr. Daniel Kiprop',
    role: 'Receiving Facility Focal',
    action: 'ATTENDANCE_CONFIRMED',
    resourceId: 'REF-2026-0420',
    detail: 'Confirmed patient attendance for diagnostic ultrasound at St. Luke Centre.',
  },
  {
    id: 'AUD-503',
    timestamp: '2026-11-17 16:40',
    actor: 'Sr. Beatrice Muthoni',
    role: 'Receiving Facility Focal',
    action: 'FACILITY_ACKNOWLEDGED',
    resourceId: 'REF-2026-0418',
    detail: 'Acknowledged receipt of red-flag cancer screening referral within SLA.',
  },
  {
    id: 'AUD-504',
    timestamp: '2026-11-16 09:30',
    actor: 'Amina Salim',
    role: 'Programme Coordinator',
    action: 'CONSENT_OPTOUT_LOGGED',
    resourceId: 'REF-2026-0424',
    detail: 'Recorded SMS opt-out preference; automated messaging disabled, routed to human call.',
  },
  {
    id: 'AUD-505',
    timestamp: '2026-11-14 15:20',
    actor: 'Dr. Hassan Bakari',
    role: 'Receiving Facility Focal',
    action: 'OUTCOME_VERIFIED_CLOSURE',
    resourceId: 'REF-2026-0421',
    detail: 'Documented clinical outcome and closed case with verified audit trail.',
  },
];

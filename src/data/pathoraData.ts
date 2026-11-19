export interface WorkflowStage {
  id: number;
  title: string;
  shortLabel: string;
  action: string;
  evidence: string;
  sampleEvent: string;
  slaWindow: string;
}

export interface PathwayOption {
  id: 'cancer' | 'ncd' | 'male' | 'mch';
  name: string;
  tier: string;
  whyItMatters: string;
  readiness: string;
  channels: string;
}

export interface KenyaCorridor {
  id: string;
  city: string;
  x: number;
  y: number;
  programType: string;
  receivingFacility: string;
  interopMode: string;
  turnaroundTarget: string;
}

export interface PilotPhase {
  step: number;
  title: string;
  weeks: string;
  summary: string;
  deliverables: string[];
}

export const WORKFLOW_STAGES: WorkflowStage[] = [
  {
    id: 1,
    title: 'Intake & Consent',
    shortLabel: 'Intake',
    action:
      'Receive a positive screen or risk signal via manual entry, secure CSV import, or an approved API interface.',
    evidence: 'Source, date, minimum patient identifiers, consent/legal basis, and pathway.',
    sampleEvent: 'POS-SCREEN-418 logged · Explicit SMS follow-up consent recorded',
    slaWindow: 'T + 0h',
  },
  {
    id: 2,
    title: 'Named Assignment',
    shortLabel: 'Assign',
    action:
      'Assign a named coordinator or responsible clinical team and establish the next required action and deadline.',
    evidence: 'Named owner, receiving destination, due date, and active case status.',
    sampleEvent: 'Assigned to M. Wanjiku (Programme Coordinator) · Due in 24h',
    slaWindow: 'T + 4h',
  },
  {
    id: 3,
    title: 'Discreet Contact',
    shortLabel: 'Contact',
    action:
      'Send a culturally reviewed, consent-led SMS or WhatsApp message, or route directly to a human coordinator.',
    evidence: 'Contact attempt, channel, delivery status, and patient response.',
    sampleEvent: 'Discreet Swahili/English appointment prompt delivered via WhatsApp',
    slaWindow: 'T + 12h',
  },
  {
    id: 4,
    title: 'Referral Handoff',
    shortLabel: 'Handoff',
    action:
      'Transmit structured referral details to the receiving facility and track explicit acknowledgment separately from sending.',
    evidence: 'Referral sent, received, and facility acknowledged as distinct timestamps.',
    sampleEvent: 'Acknowledged by Kenyatta Referral Desk · Slot confirmed',
    slaWindow: 'T + 24h',
  },
  {
    id: 5,
    title: 'Attendance & Evaluation',
    shortLabel: 'Attend',
    action:
      'Confirm patient attendance at the receiving facility and request the partner-authorized evaluation status.',
    evidence: 'Attendance status, evaluation date, and authorized clinical outcome summary.',
    sampleEvent: 'Patient attended · Diagnostic evaluation completed at site',
    slaWindow: 'T + 72h',
  },
  {
    id: 6,
    title: 'SLA Escalation',
    shortLabel: 'Escalate',
    action:
      'Automatically remind the named owner and escalate overdue or stalled cases using partner-approved rules.',
    evidence: 'Escalation trigger, recipient, timestamp, and documented resolution.',
    sampleEvent: 'SLA breach alert routed to Clinical Lead · Barrier check initiated',
    slaWindow: 'On Breach',
  },
  {
    id: 7,
    title: 'Verified Closure',
    shortLabel: 'Close',
    action:
      'Close the case only when the defined clinical outcome or an explicitly approved terminal status is recorded.',
    evidence: 'Closure reason, outcome source, timestamp, and immutable audit trail.',
    sampleEvent: 'Terminal status verified · Closed with complete audit record',
    slaWindow: 'Endpoint',
  },
];

export const CORE_PILLARS = [
  {
    id: 'ownership',
    title: 'Named Case Ownership',
    description:
      'Every positive screen has a named coordinator, a next step and a deadline.',
  },
  {
    id: 'sla',
    title: 'Time-Bound SLA Escalations',
    description:
      'Stalled or unacknowledged referrals are escalated to a person before patients drop out.',
  },
  {
    id: 'verification',
    title: 'Distinct Event Verification',
    description:
      'Sent, acknowledged, attended and outcome are recorded separately. Sending never closes a case.',
  },
  {
    id: 'interoperability',
    title: 'Lightweight Interoperability',
    description:
      'Works beside existing EMRs and intake tools. Start with CSV, grow into FHIR APIs.',
  },
];

export const PATHWAY_OPTIONS: PathwayOption[] = [
  {
    id: 'cancer',
    name: 'Cancer Screening',
    tier: 'Priority 90-Day Pilot',
    whyItMatters:
      'Abnormal screening results often require multiple diagnostic and specialist steps across separate facilities.',
    readiness:
      'Strong primary pilot candidate where a screening programme and receiving oncology/diagnostic facility are committed.',
    channels: 'Web intake · CSV/API · SMS & Coordinator follow-up',
  },
  {
    id: 'ncd',
    name: 'NCD Screening',
    tier: 'Priority 90-Day Pilot',
    whyItMatters:
      'Individuals flagged with elevated blood pressure or glucose require timely confirmatory assessment and continuity.',
    readiness:
      'Ideal for high-volume community-to-facility operational validation with clear baseline tracking.',
    channels: 'Community intake · Clinic handoff · Discreet SMS reminders',
  },
  {
    id: 'male',
    name: 'Male Reproductive Health',
    tier: 'Specialist Roadmap',
    whyItMatters:
      'Privacy sensitivities, stigma, and delayed care-seeking widen the gap between initial risk signal and specialist evaluation.',
    readiness:
      'Differentiated consent-first pathway with discreet messaging, retained for committed urology/andrology partners.',
    channels: 'Private web intake · WhatsApp/SMS · Per-item consent control',
  },
  {
    id: 'mch',
    name: 'Maternal & Child Health',
    tier: 'Future Expansion',
    whyItMatters:
      'Time-sensitive referrals span community health promoters, primary clinics, and multi-level obstetric/paediatric care.',
    readiness:
      'Planned expansion contingent on pathway-specific clinical governance and multi-tier facility readiness.',
    channels: 'CHP mobile intake · Multi-facility escalation · Audit trail',
  },
];

export const KENYA_CORRIDORS: KenyaCorridor[] = [
  {
    id: 'nairobi',
    city: 'Nairobi',
    x: 204,
    y: 236,
    programType: 'Urban Cancer & NCD Screening Network',
    receivingFacility: 'Public, Faith-Based & Private Referral Hospitals',
    interopMode: 'Phase 1 Secure CSV / Phase 2 EMR API',
    turnaroundTarget: 'Target: < 72h Facility Acknowledgment',
  },
  {
    id: 'kisumu',
    city: 'Kisumu',
    x: 108,
    y: 202,
    programType: 'County Community Health Promoter Referrals',
    receivingFacility: 'County & Sub-County Diagnostic Centres',
    interopMode: 'Discreet SMS/WhatsApp + Coordinator Queue',
    turnaroundTarget: 'Target: Full Attendance Verification',
  },
  {
    id: 'eldoret',
    city: 'Eldoret',
    x: 132,
    y: 164,
    programType: 'Regional Oncology & Metabolic Follow-Up',
    receivingFacility: 'Regional Teaching & Referral Hospital',
    interopMode: 'Structured Status-Return Portal',
    turnaroundTarget: 'Target: Zero Unacknowledged Handoffs',
  },
  {
    id: 'nakuru',
    city: 'Nakuru',
    x: 162,
    y: 208,
    programType: 'Mobile Screening Clinic Corridor',
    receivingFacility: 'County Outpatient & Specialty Clinics',
    interopMode: 'Batch CSV Import + SLA Escalation',
    turnaroundTarget: 'Target: Weekly Cohort Funnel Audit',
  },
  {
    id: 'mombasa',
    city: 'Mombasa',
    x: 292,
    y: 332,
    programType: 'Coastal Preventive Care & NCD Pathway',
    receivingFacility: 'Coastal Faith-Based & Public Facilities',
    interopMode: 'Bilingual Swahili/English Consent Layer',
    turnaroundTarget: 'Target: Documented Terminal Closure',
  },
];

export const PILOT_PHASES: PilotPhase[] = [
  {
    step: 1,
    title: 'Mobilise & Configure',
    weeks: 'Weeks 1–5',
    summary:
      'Confirm clinical sponsors, data protection contacts, baseline metrics, and configure pathway stages, deadlines, and culturally reviewed messaging.',
    deliverables: [
      'Named executive, clinical, and data protection leads',
      'Signed-off pathway rule pack & red-flag escalation rules',
      'Data map, consent model, and secure intake interface',
    ],
  },
  {
    step: 2,
    title: 'Test & Pass Go-Live Gate',
    weeks: 'Weeks 6–7',
    summary:
      'Run synthetic-case simulations covering overdue, failed-contact, and red-flag scenarios. Live deployment proceeds only once every safety condition passes.',
    deliverables: [
      'Clinical sign-off on pathway boundaries & closure criteria',
      'Completed data protection assessment & agreements',
      'Verified status-return route at receiving facility',
    ],
  },
  {
    step: 3,
    title: 'Live Pilot & Evaluate',
    weeks: 'Weeks 8–13',
    summary:
      'Operate with the live patient cohort, deliver weekly funnel reviews, and evaluate operational gains strictly against the partner’s own baseline.',
    deliverables: [
      'Weekly operational funnel & SLA adherence reporting',
      'Live vs. baseline comparison across completion & velocity',
      'Final evaluation report with scale, revise, or stop decision',
    ],
  },
];

export const EVALUATION_METRICS = [
  {
    label: 'Referral Completion Rate',
    detail: 'Share of eligible referrals reaching a verified clinical endpoint against a defined denominator.',
    emphasis: 'Primary Metric',
  },
  {
    label: 'Velocity to Evaluation',
    detail: 'Elapsed days from positive screening signal to first appropriate clinical evaluation.',
    emphasis: 'Baseline Delta',
  },
  {
    label: 'Confirmed Acknowledgment',
    detail: 'Proportion of referrals explicitly acknowledged by the receiving facility within SLA.',
    emphasis: 'Handoff Integrity',
  },
  {
    label: 'Coordinator Effort',
    detail: 'Time saved on manual phone/spreadsheet follow-up per case through automated queues.',
    emphasis: 'Operational Load',
  },
];

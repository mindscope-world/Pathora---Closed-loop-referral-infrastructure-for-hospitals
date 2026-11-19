import { Router, type Request, type Response } from 'express';
import type {
  CommsLogEntry,
  PathwayName,
  ReferralCase,
  TeamMember,
} from '../../../src/data/dashboardData.ts';
import { requireAuth } from '../auth.ts';
import { db, nextId, save } from '../db.ts';
import { dateFromNow, nowTimestamp, str } from '../util.ts';

export const workspaceRouter = Router();
workspaceRouter.use(requireAuth);

const PATHWAYS: PathwayName[] = ['Cancer Screening', 'NCD Screening', 'Male Reproductive Health'];
const TEAM_ROLES: TeamMember['role'][] = [
  'Programme Manager',
  'Programme Coordinator',
  'Receiving Facility Focal',
  'Partner Clinical Lead',
  'Data Protection Contact',
];

function snapshot() {
  return {
    cases: db.cases,
    facilities: db.facilities,
    templates: db.templates,
    commsLog: db.commsLog,
    rulePacks: db.rulePacks,
    auditEvents: db.auditEvents,
    team: db.team,
  };
}

function appendAudit(actor: string, role: string, action: string, resourceId: string, detail: string) {
  db.auditEvents.unshift({
    id: nextId('audit', (n) => `AUD-${n}`),
    timestamp: nowTimestamp(),
    actor,
    role,
    action,
    resourceId,
    detail,
  });
}

/** Save and respond with the full workspace so the client can replace its state. */
function commit(res: Response, status = 200) {
  save();
  res.status(status).json(snapshot());
}

function findCase(req: Request, res: Response): ReferralCase | null {
  const found = db.cases.find((c) => c.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: `Referral ${req.params.id} was not found.` });
    return null;
  }
  return found;
}

function newCaseId(): string {
  const year = new Date().getFullYear();
  return nextId('case', (n) => `REF-${year}-${String(n).padStart(4, '0')}`);
}

function toPathway(value: string): PathwayName {
  return PATHWAYS.find((p) => p === value) ?? 'Cancer Screening';
}

workspaceRouter.get('/', (_req, res) => {
  res.json(snapshot());
});

// ---- Cases ---------------------------------------------------------------

workspaceRouter.post('/cases', (req, res) => {
  const user = req.user!;
  const patientName = str(req.body?.patientName);
  const patientCodeInput = str(req.body?.patientCode).toUpperCase();
  if (!patientName && !patientCodeInput) {
    res.status(400).json({ error: 'Please enter a patient name or identifier code.' });
    return;
  }

  const facilityName = str(req.body?.receivingFacility);
  if (!db.facilities.some((f) => f.name === facilityName)) {
    res.status(400).json({ error: 'Please choose a valid receiving facility.' });
    return;
  }

  const ts = nowTimestamp();
  const code = patientCodeInput || nextId('patient', (n) => `PT-${n}`);
  const redFlag = Boolean(req.body?.redFlag);
  const pathway = toPathway(str(req.body?.pathway));
  const coordinator = str(req.body?.coordinator) || user.name;

  const created: ReferralCase = {
    id: newCaseId(),
    patientCode: code,
    patientName: patientName || `Patient ${code}`,
    patientLabel: str(req.body?.patientLabel) || 'Cohort NBO · Screened',
    pathway,
    sourceProgram: str(req.body?.sourceProgram) || 'Direct Web Intake',
    coordinator,
    receivingFacility: facilityName,
    stage: 'Handoff Sent',
    status: 'Awaiting Ack',
    consentSms: Boolean(req.body?.consentSms),
    consentWhatsApp: false,
    optedOut: false,
    createdAt: ts,
    dueDate: dateFromNow(4),
    slaHoursRemaining: 36,
    redFlag,
    notes: redFlag
      ? 'Red-flag positive screen logged with expedited clinical escalation.'
      : 'Positive screen logged; awaiting receiving facility acknowledgment.',
    milestones: { referralIssuedAt: ts },
  };

  db.cases.unshift(created);
  appendAudit(
    coordinator,
    'Programme Coordinator',
    'CASE_CREATED',
    created.id,
    `Logged ${pathway} positive screen (${created.patientName} · ${created.patientCode}) routed to ${facilityName}.`
  );
  commit(res, 201);
});

workspaceRouter.post('/cases/import', (req, res) => {
  const user = req.user!;
  const csv = str(req.body?.csv);
  const lines = csv
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    res.status(400).json({ error: 'Please enter at least one CSV row to import.' });
    return;
  }

  const ts = nowTimestamp();
  const imported: ReferralCase[] = [];

  lines.forEach((line, index) => {
    const cols = line.split(',').map((s) => s.trim());
    if (cols.length < 2) return;
    const facility = db.facilities.find((f) => f.name === cols[5])?.name ?? db.facilities[0].name;
    imported.push({
      id: newCaseId(),
      patientCode: cols[0] || `PT-IMP-${index + 1}`,
      patientName: `Imported Patient ${cols[0] || index + 1}`,
      patientLabel: cols[1] || 'CSV Imported Cohort',
      pathway: toPathway(cols[2]),
      sourceProgram: cols[3] || 'Secure CSV Intake',
      coordinator: cols[4] || user.name,
      receivingFacility: facility,
      stage: 'Handoff Sent',
      status: 'Awaiting Ack',
      consentSms: true,
      consentWhatsApp: false,
      optedOut: false,
      createdAt: ts,
      dueDate: dateFromNow(5),
      slaHoursRemaining: 48,
      redFlag: false,
      notes: 'Imported via Phase 1 Secure CSV Intake.',
      milestones: { referralIssuedAt: ts },
    });
  });

  if (imported.length === 0) {
    res.status(400).json({ error: 'Could not parse valid rows. Expected comma-separated columns.' });
    return;
  }

  db.cases.unshift(...imported);
  appendAudit(
    user.name,
    user.role,
    'CSV_BATCH_IMPORTED',
    `BATCH-${imported.length}`,
    `Imported ${imported.length} consented referrals via secure CSV intake.`
  );
  save();
  res.status(201).json({ importedCount: imported.length, workspace: snapshot() });
});

workspaceRouter.post('/cases/:id/acknowledge', (req, res) => {
  const c = findCase(req, res);
  if (!c) return;
  c.stage = 'Acknowledged';
  c.status = 'Active';
  c.milestones.facilityAcknowledgedAt = nowTimestamp();
  appendAudit(
    req.user!.name,
    'Receiving Facility Focal',
    'FACILITY_ACKNOWLEDGED',
    c.id,
    'Confirmed referral receipt via Receiving Facility Desk.'
  );
  commit(res);
});

workspaceRouter.post('/cases/:id/attendance', (req, res) => {
  const c = findCase(req, res);
  if (!c) return;
  const ts = nowTimestamp();
  c.stage = 'Attended';
  c.status = 'Active';
  c.milestones.facilityAcknowledgedAt ??= ts;
  c.milestones.patientAttendedAt = ts;
  appendAudit(
    req.user!.name,
    'Receiving Facility Focal',
    'ATTENDANCE_CONFIRMED',
    c.id,
    'Confirmed patient clinical attendance at receiving facility.'
  );
  commit(res);
});

workspaceRouter.post('/cases/:id/close', (req, res) => {
  const c = findCase(req, res);
  if (!c) return;
  const closureReason = str(req.body?.closureReason);
  if (!closureReason) {
    res.status(400).json({ error: 'Please choose a terminal closure reason.' });
    return;
  }
  const source = str(req.body?.outcomeSource) || `${c.receivingFacility} Focal`;
  const ts = nowTimestamp();

  c.stage = 'Closed';
  c.status = 'Closed Verified';
  c.slaHoursRemaining = 0;
  c.closureReason = closureReason;
  c.outcomeSource = source;
  c.milestones.facilityAcknowledgedAt ??= ts;
  c.milestones.patientAttendedAt ??= ts;
  c.milestones.evaluationCompletedAt ??= ts;
  c.milestones.outcomeDocumentedAt = ts;

  appendAudit(
    source,
    'Receiving Facility Focal',
    'OUTCOME_VERIFIED_CLOSURE',
    c.id,
    `Closed case with verified outcome: ${closureReason}`
  );
  commit(res);
});

workspaceRouter.post('/cases/:id/escalate', (req, res) => {
  const c = findCase(req, res);
  if (!c) return;
  const reason = str(req.body?.reason) || 'SLA breach escalated to clinical lead.';
  c.stage = 'Escalated';
  c.status = 'Overdue SLA';
  c.notes = `${c.notes} | Escalated: ${reason}`;
  appendAudit('System SLA Monitor', 'Programme Coordinator', 'SLA_ESCALATION_TRIGGERED', c.id, reason);
  commit(res);
});

workspaceRouter.post('/cases/:id/barrier-resolution', (req, res) => {
  const c = findCase(req, res);
  if (!c) return;
  const note = str(req.body?.note);
  if (!note) {
    res.status(400).json({ error: 'Please describe the barrier resolution.' });
    return;
  }
  c.status = 'Active';
  if (c.stage === 'Escalated') c.stage = 'Contacted';
  c.slaHoursRemaining = 24;
  c.notes = `Resolution logged: ${note}`;
  appendAudit(req.user!.name, req.user!.role, 'BARRIER_RESOLUTION_LOGGED', c.id, note);
  commit(res);
});

workspaceRouter.patch('/cases/:id/owner', (req, res) => {
  const c = findCase(req, res);
  if (!c) return;
  const owner = str(req.body?.coordinator);
  if (!owner) {
    res.status(400).json({ error: 'Please choose a named owner.' });
    return;
  }
  c.coordinator = owner;
  appendAudit(
    req.user!.name,
    req.user!.role,
    'CASE_REASSIGNED',
    c.id,
    `Named ownership transferred to ${owner}.`
  );
  commit(res);
});

workspaceRouter.post('/cases/:id/messages', (req, res) => {
  const c = findCase(req, res);
  if (!c) return;
  const channel = str(req.body?.channel);
  const templateName = str(req.body?.templateName);
  if (channel !== 'SMS' && channel !== 'WhatsApp') {
    res.status(400).json({ error: 'Channel must be SMS or WhatsApp.' });
    return;
  }
  if (!templateName) {
    res.status(400).json({ error: 'Please choose a message template.' });
    return;
  }

  const entry: CommsLogEntry = {
    id: nextId('message', (n) => `MSG-${n}`),
    caseId: c.id,
    patientCode: c.patientCode,
    channel,
    templateName,
    deliveryStatus: c.optedOut ? 'Blocked (Opt-out)' : 'Delivered',
    timestamp: nowTimestamp(),
  };
  db.commsLog.unshift(entry);
  appendAudit(
    c.coordinator,
    'Programme Coordinator',
    c.optedOut ? 'MESSAGE_BLOCKED_OPTOUT' : 'DISCREET_MESSAGE_SENT',
    c.id,
    c.optedOut
      ? `Blocked ${channel} template (${templateName}) due to recorded patient opt-out.`
      : `Sent discreet ${channel} template "${templateName}".`
  );
  commit(res, 201);
});

workspaceRouter.post('/cases/:id/opt-out/toggle', (req, res) => {
  const c = findCase(req, res);
  if (!c) return;
  c.optedOut = !c.optedOut;
  appendAudit(
    req.user!.name,
    'Data Protection Contact',
    c.optedOut ? 'CONSENT_OPTOUT_RECORDED' : 'CONSENT_RESTORED',
    c.id,
    c.optedOut
      ? 'Patient opted out of automated SMS/WhatsApp; routed to human coordinator.'
      : 'Patient follow-up consent restored.'
  );
  commit(res);
});

// ---- Pathway rule packs --------------------------------------------------

workspaceRouter.patch('/rule-packs/:id', (req, res) => {
  const pack = db.rulePacks.find((p) => p.id === req.params.id);
  if (!pack) {
    res.status(404).json({ error: `Rule pack ${req.params.id} was not found.` });
    return;
  }
  const ackSlaHours = Number(req.body?.ackSlaHours);
  const evalTargetDays = Number(req.body?.evalTargetDays);
  if (!Number.isFinite(ackSlaHours) || ackSlaHours <= 0 || !Number.isFinite(evalTargetDays) || evalTargetDays <= 0) {
    res.status(400).json({ error: 'SLA hours and evaluation days must be positive numbers.' });
    return;
  }
  pack.ackSlaHours = ackSlaHours;
  pack.evalTargetDays = evalTargetDays;
  appendAudit(
    req.user!.name,
    req.user!.role,
    'RULE_PACK_UPDATED',
    pack.id,
    `Updated facility acknowledgment SLA to ${ackSlaHours}h and evaluation target to ${evalTargetDays} days.`
  );
  commit(res);
});

// ---- Team ----------------------------------------------------------------

workspaceRouter.post('/team', (req, res) => {
  const name = str(req.body?.name);
  const role = str(req.body?.role) as TeamMember['role'];
  if (!name) {
    res.status(400).json({ error: 'Please enter the team member name.' });
    return;
  }
  if (!TEAM_ROLES.includes(role)) {
    res.status(400).json({ error: 'Please choose a valid team role.' });
    return;
  }
  const member: TeamMember = {
    id: nextId('team', (n) => `USR-${String(n).padStart(2, '0')}`),
    name,
    role,
    organization: str(req.body?.organization) || req.user!.organization,
    accessScope: str(req.body?.accessScope),
    active: true,
  };
  db.team.push(member);
  appendAudit(
    req.user!.name,
    req.user!.role,
    'TEAM_USER_ADDED',
    member.id,
    `Added ${member.name} as ${member.role}.`
  );
  commit(res, 201);
});

workspaceRouter.post('/team/:id/toggle-active', (req, res) => {
  const member = db.team.find((m) => m.id === req.params.id);
  if (!member) {
    res.status(404).json({ error: `Team member ${req.params.id} was not found.` });
    return;
  }
  member.active = !member.active;
  appendAudit(
    req.user!.name,
    req.user!.role,
    member.active ? 'TEAM_USER_ACTIVATED' : 'TEAM_USER_DEACTIVATED',
    member.id,
    `${member.active ? 'Activated' : 'Deactivated'} ${member.name}.`
  );
  commit(res);
});

// ---- Audit ---------------------------------------------------------------

workspaceRouter.post('/audit/exports', (req, res) => {
  const exportType = str(req.body?.exportType) || 'report';
  appendAudit(req.user!.name, req.user!.role, 'DATA_EXPORTED', 'REPORT', `Exported ${exportType}.`);
  commit(res, 201);
});

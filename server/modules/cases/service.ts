import { ROLE_LABELS, PATHWAY_LABELS, type CaseDetailDto, type CaseDto, type CaseListResponse, type AssigneeDto, type PathwayId } from '../../../shared/types';
import { can } from '../../../shared/permissions';
import { forOrg, type TenantDb } from '../../db/tenant';
import type { MilestoneType, Prisma } from '../../db/generated/client';
import { aad, encryptField } from '../../lib/crypto';
import { HttpError } from '../../lib/errors';
import { nextPatientCode, nextRefNumber, reserveRefNumbers } from '../../lib/ids';
import { phoneHash } from '../../lib/phone';
import { nameTokens } from '../../lib/searchIndex';
import { caseScope } from '../../middleware/tenant';
import { nextConsentTime, recordOptOut, recordRestore, restorableChannels } from '../consent/consent';
import type { AuthContext } from '../../types';
import { appendAudit, appendAuditBatch } from '../audit/append';
import { toAuditEventDto } from '../audit/dto';
import { caseInclude, hasMilestone, toCaseDto, type CaseRow } from './dto';
import { buildCaseWhere, decodeCursor, encodeCursor, escalationWhere, type ListQuery } from './queries';
import { ackDeadline, barrierDeadline, evaluationDeadline } from './sla';
import { transition, type CaseEvent } from './stateMachine';

type Tx = Parameters<Parameters<TenantDb['$transaction']>[0]>[0];
const asAuditTx = (tx: Tx) => tx as unknown as Prisma.TransactionClient;

const NOTES_MAX = 2000;
const ASSIGNEE_ROLES = ['PROGRAMME_MANAGER', 'PROGRAMME_COORDINATOR'] as const;

// ───────────────────────────── helpers ─────────────────────────────

function audit(tx: Tx, auth: AuthContext, action: string, resourceId: string, detail: string, resourceType = 'ReferralCase') {
  return appendAudit(asAuditTx(tx), {
    orgId: auth.orgId, actorId: auth.userId, actorLabel: auth.name, actorRole: ROLE_LABELS[auth.role],
    action, resourceType, resourceId, detail,
  });
}

/** Appends a labelled entry to the running notes, keeping the most recent NOTES_MAX characters. */
export function appendNote(notes: string, label: string, text: string): string {
  const joined = notes ? `${notes} | ${label}: ${text}` : `${label}: ${text}`;
  return joined.length > NOTES_MAX ? joined.slice(joined.length - NOTES_MAX) : joined;
}

/** Loads a case the caller may see, or throws 404 (also for another facility's case: existence is not leaked). */
export async function loadCase(db: TenantDb | Tx, auth: AuthContext, ref: string): Promise<CaseRow> {
  const row = await db.referralCase.findFirst({
    where: { AND: [caseScope(auth), { refNumber: ref }] },
    include: caseInclude,
  });
  if (!row) throw HttpError.notFound('Referral not found');
  return row as CaseRow;
}

const factsOf = (row: CaseRow) => ({
  stage: row.stage,
  hasAcknowledged: hasMilestone(row, 'FACILITY_ACKNOWLEDGED'),
  hasAttended: hasMilestone(row, 'PATIENT_ATTENDED'),
});

/**
 * Optimistic-lock write. The UPDATE only matches the version we read, so two concurrent actions
 * cannot both apply: the loser matches zero rows and gets a 409. `expectedVersion` additionally
 * lets a client reject a change made against a stale view of the case.
 */
async function applyUpdate(tx: Tx, row: CaseRow, expectedVersion: number | undefined, data: Prisma.ReferralCaseUncheckedUpdateManyInput) {
  if (expectedVersion !== undefined && expectedVersion !== row.version) {
    throw new HttpError(409, 'VERSION_CONFLICT', 'This case was changed by someone else. Reload and try again.');
  }
  const { count } = await tx.referralCase.updateMany({
    where: { id: row.id, version: row.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (count !== 1) throw new HttpError(409, 'VERSION_CONFLICT', 'This case was changed by someone else. Reload and try again.');
}

const addMilestone = (tx: Tx, caseId: string, type: MilestoneType, userId: string, at: Date) =>
  tx.caseMilestone.create({ data: { caseId, type, occurredAt: at, recordedBy: userId } });

async function reload(tx: Tx | TenantDb, auth: AuthContext, ref: string, now: Date): Promise<CaseDto> {
  return toCaseDto(await loadCase(tx, auth, ref), now);
}

/**
 * Runs one case mutation: load → state-machine check → write + milestone + audit, atomically.
 * `body` performs the change through `applyUpdate`, which enforces the optimistic lock.
 */
async function mutate(
  auth: AuthContext,
  ref: string,
  body: (tx: Tx, row: CaseRow, now: Date) => Promise<void>,
): Promise<CaseDto> {
  const now = new Date();
  return forOrg(auth.orgId).$transaction(async (tx) => {
    const row = await loadCase(tx, auth, ref);
    await body(tx, row, now);
    return reload(tx, auth, ref, now);
  });
}

// ───────────────────────────── reads ─────────────────────────────

export async function listCases(auth: AuthContext, q: ListQuery): Promise<CaseListResponse> {
  const db = forOrg(auth.orgId);
  const now = new Date();
  const cursorId = q.cursor ? decodeCursor(q.cursor) : null;
  if (q.cursor && !cursorId) throw HttpError.badRequest('Invalid cursor');

  const rows = (await db.referralCase.findMany({
    where: buildCaseWhere(auth, q, now),
    include: caseInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
  })) as CaseRow[];

  const page = rows.slice(0, q.limit);
  return {
    cases: page.map((r) => toCaseDto(r, now)),
    nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1].id) : null,
  };
}

/** The attention queue, most urgent first. */
export async function listEscalations(auth: AuthContext): Promise<CaseDto[]> {
  const now = new Date();
  const rows = (await forOrg(auth.orgId).referralCase.findMany({
    where: { AND: [caseScope(auth), { isSynthetic: false }, escalationWhere(now)] },
    include: caseInclude,
    orderBy: [{ slaDueAt: 'asc' }, { id: 'asc' }],
    take: 200,
  })) as CaseRow[];
  return rows.map((r) => toCaseDto(r, now));
}

export async function searchCases(auth: AuthContext, q: string, limit = 8): Promise<CaseDto[]> {
  return (await listCases(auth, { q, limit } as ListQuery)).cases;
}

/** One case as the list shows it (no audit entry; used to return the result of an action). */
export async function getCaseSummary(auth: AuthContext, ref: string): Promise<CaseDto> {
  return toCaseDto(await loadCase(forOrg(auth.orgId), auth, ref), new Date());
}

/** Full case view. Opening a case exposes identifiers, so it is audited. */
export async function getCaseDetail(auth: AuthContext, ref: string): Promise<CaseDetailDto> {
  const db = forOrg(auth.orgId);
  const now = new Date();
  return db.$transaction(async (tx) => {
    const row = await loadCase(tx, auth, ref);
    await audit(tx, auth, 'CASE_VIEWED', ref, `Opened referral ${ref} (${row.patient.patientCode}).`);

    const timeline = can(auth.role, 'audit.read')
      ? await tx.auditEvent.findMany({ where: { resourceId: ref }, orderBy: { id: 'desc' }, take: 200 })
      : [];
    const comms = can(auth.role, 'comms.read')
      ? await tx.commsLog.findMany({ where: { caseId: row.id }, orderBy: { requestedAt: 'desc' }, take: 200 })
      : [];

    return {
      ...toCaseDto(row, now),
      timeline: timeline.map(toAuditEventDto),
      comms: comms.map((c) => ({
        id: c.id, channel: c.channel, templateName: c.templateName, status: c.status, sentAt: c.requestedAt.toISOString(),
      })),
    };
  });
}

export async function listAssignees(auth: AuthContext): Promise<AssigneeDto[]> {
  const users = await forOrg(auth.orgId).user.findMany({
    where: { active: true, role: { in: [...ASSIGNEE_ROLES] } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, role: true },
  });
  return users;
}

// ───────────────────────────── create ─────────────────────────────

export interface NewCaseInput {
  patientName?: string;
  patientCode?: string;
  patientLabel?: string;
  pathway: PathwayId;
  sourceProgram: string;
  coordinatorId: string;
  facilityId: string;
  redFlag: boolean;
  consentSms: boolean;
  consentBasis?: string;
  /** E.164. Stored (encrypted) only when the patient record is CREATED; change it later with setContact. */
  patientPhone?: string;
  notes?: string;
}

interface ResolvedRefs {
  facilityName: string;
  coordinatorOk: boolean;
  pack: { id: string; ackSlaHours: number; contactSlaHours: number; evalTargetDays: number; status: string };
}

async function resolveRefs(tx: Tx, auth: AuthContext, input: Pick<NewCaseInput, 'pathway' | 'facilityId' | 'coordinatorId'>): Promise<ResolvedRefs> {
  const facility = await tx.facility.findFirst({ where: { id: input.facilityId }, select: { name: true } });
  if (!facility) throw new HttpError(422, 'INVALID_REFERENCE', 'Unknown receiving facility');
  const coordinator = await tx.user.findFirst({
    where: { id: input.coordinatorId, active: true, role: { in: [...ASSIGNEE_ROLES] } },
    select: { id: true },
  });
  if (!coordinator) throw new HttpError(422, 'INVALID_REFERENCE', 'Unknown or inactive owner');
  const pack = await tx.rulePack.findFirst({ where: { pathway: input.pathway }, orderBy: { version: 'desc' } });
  if (!pack || pack.status === 'COMING_SOON') {
    throw new HttpError(422, 'PATHWAY_UNAVAILABLE', `${PATHWAY_LABELS[input.pathway]} is not available for referrals yet`);
  }
  return { facilityName: facility.name, coordinatorOk: true, pack };
}

/** The encrypted number and its lookup hash, or nothing. */
const phoneColumns = (orgId: string, e164?: string) =>
  e164 ? { phoneEnc: encryptField(e164, aad.patientPhone(orgId)), phoneHash: phoneHash(e164) } : {};

const DEFAULT_NOTE = 'Positive screen logged; awaiting receiving facility acknowledgment.';
const RED_FLAG_NOTE = 'Red-flag positive screen logged with expedited clinical escalation.';

/** Case columns derived from the input and the pathway's SLA. Shared by single create and bulk import so they cannot drift. */
function newCaseData(auth: AuthContext, input: NewCaseInput, refs: ResolvedRefs, patientId: string, refNumber: string, now: Date) {
  return {
    refNumber, orgId: auth.orgId, patientId, pathway: input.pathway, rulePackId: refs.pack.id,
    sourceProgram: input.sourceProgram, coordinatorId: input.coordinatorId, facilityId: input.facilityId,
    stage: 'HANDOFF_SENT' as const, redFlag: input.redFlag,
    notes: input.notes?.trim() || (input.redFlag ? RED_FLAG_NOTE : DEFAULT_NOTE),
    issuedAt: now, slaDueAt: ackDeadline(now, refs.pack), dueDate: evaluationDeadline(now, refs.pack),
  };
}

const createdDetail = (input: NewCaseInput, code: string, facilityName: string) =>
  // Identifiers only (patient code), never the name, in the audit trail.
  `Logged ${PATHWAY_LABELS[input.pathway]} positive screen (${code}) routed to ${facilityName}.`;

const consentRow = (auth: AuthContext, input: NewCaseInput, patientId: string, now: Date) => ({
  patientId, channel: 'SMS' as const, granted: true, event: 'CAPTURED' as const,
  lawfulBasis: input.consentBasis ?? 'Explicit consent captured at screening', recordedById: auth.userId, recordedAt: now,
});

/** Core create for one case. Must run inside a transaction. */
async function insertCase(tx: Tx, auth: AuthContext, input: NewCaseInput, refs: ResolvedRefs, now: Date): Promise<{ ref: string; patientCode: string }> {
  const code = input.patientCode?.trim().toUpperCase() || (await nextPatientCode(asAuditTx(tx), auth.orgId));
  const name = input.patientName?.trim() || `Patient ${code}`;

  let patient = await tx.patient.findFirst({ where: { patientCode: code }, select: { id: true } });
  if (patient) {
    const open = await tx.referralCase.findFirst({
      where: { patientId: patient.id, pathway: input.pathway, stage: { not: 'CLOSED' }, isSynthetic: false },
      select: { refNumber: true },
    });
    if (open) {
      throw new HttpError(409, 'DUPLICATE_REFERRAL', `${code} already has an open ${PATHWAY_LABELS[input.pathway]} referral (${open.refNumber})`);
    }
  } else {
    patient = await tx.patient.create({
      data: {
        orgId: auth.orgId, patientCode: code,
        nameEnc: encryptField(name, aad.patientName(auth.orgId)),
        nameTokens: nameTokens(auth.orgId, name),
        label: input.patientLabel?.trim() || 'Screened',
        ...phoneColumns(auth.orgId, input.patientPhone),
      },
      select: { id: true },
    });
  }

  const ref = await nextRefNumber(asAuditTx(tx), auth.orgId);
  const row = await tx.referralCase.create({ data: newCaseData(auth, input, refs, patient.id, ref, now), select: { id: true } });

  await addMilestone(tx, row.id, 'REFERRAL_ISSUED', auth.userId, now);
  if (input.consentSms) await tx.consent.create({ data: consentRow(auth, input, patient.id, now) });
  await audit(tx, auth, 'CASE_CREATED', ref, createdDetail(input, code, refs.facilityName));
  return { ref, patientCode: code };
}

export async function createCase(auth: AuthContext, input: NewCaseInput): Promise<CaseDto> {
  const db = forOrg(auth.orgId);
  const now = new Date();
  return db.$transaction(async (tx) => {
    const refs = await resolveRefs(tx, auth, input);
    const { ref } = await insertCase(tx, auth, input, refs, now);
    return reload(tx, auth, ref, now);
  });
}

// ───────────────────────────── lifecycle actions ─────────────────────────────

export const acknowledgeCase = (auth: AuthContext, ref: string, expectedVersion?: number) =>
  mutate(auth, ref, async (tx, row, now) => {
    const next = transition(factsOf(row), 'ACKNOWLEDGE');
    await applyUpdate(tx, row, expectedVersion, { stage: next, slaDueAt: evaluationDeadline(row.issuedAt, row.rulePack) });
    await addMilestone(tx, row.id, 'FACILITY_ACKNOWLEDGED', auth.userId, now);
    await audit(tx, auth, 'FACILITY_ACKNOWLEDGED', ref, `Confirmed referral receipt at ${row.facility.name}.`);
  });

export const confirmAttendance = (auth: AuthContext, ref: string, expectedVersion?: number) =>
  mutate(auth, ref, async (tx, row, now) => {
    const next = transition(factsOf(row), 'ATTEND');
    await applyUpdate(tx, row, expectedVersion, { stage: next });
    await addMilestone(tx, row.id, 'PATIENT_ATTENDED', auth.userId, now);
    await audit(tx, auth, 'ATTENDANCE_CONFIRMED', ref, `Confirmed patient attendance at ${row.facility.name}.`);
  });

export const closeCase = (auth: AuthContext, ref: string, input: { closureReason: string; outcomeSource?: string }, expectedVersion?: number) =>
  mutate(auth, ref, async (tx, row, now) => {
    const next = transition(factsOf(row), 'CLOSE');
    // Attribute the outcome to a real person by default rather than an anonymous desk.
    const outcomeSource = input.outcomeSource?.trim() || `${auth.name} (${row.facility.name})`;
    await applyUpdate(tx, row, expectedVersion, { stage: next, closedAt: now, closureReason: input.closureReason, outcomeSource });
    await addMilestone(tx, row.id, 'EVALUATION_COMPLETED', auth.userId, now);
    await addMilestone(tx, row.id, 'OUTCOME_DOCUMENTED', auth.userId, now);
    await audit(tx, auth, 'OUTCOME_VERIFIED_CLOSURE', ref, `Closed case with verified outcome: ${input.closureReason}`);
  });

export const escalateCase = (auth: AuthContext, ref: string, input: { reason: string }, expectedVersion?: number) =>
  mutate(auth, ref, async (tx, row) => {
    const next = transition(factsOf(row), 'ESCALATE');
    await applyUpdate(tx, row, expectedVersion, { stage: next, notes: appendNote(row.notes, 'Escalated', input.reason) });
    await audit(tx, auth, 'CASE_ESCALATED', ref, input.reason);
  });

export const resolveBarrier = (auth: AuthContext, ref: string, input: { note: string }, expectedVersion?: number) =>
  mutate(auth, ref, async (tx, row, now) => {
    const next = transition(factsOf(row), 'RESOLVE_BARRIER');
    await applyUpdate(tx, row, expectedVersion, {
      stage: next,
      // A resolved barrier gives the case a fresh window to act, per the pathway's contact SLA.
      slaDueAt: barrierDeadline(now, row.rulePack),
      notes: appendNote(row.notes, 'Resolution logged', input.note),
    });
    await audit(tx, auth, 'BARRIER_RESOLUTION_LOGGED', ref, input.note);
  });

export const reassignCase = (auth: AuthContext, ref: string, input: { coordinatorId: string }, expectedVersion?: number) =>
  mutate(auth, ref, async (tx, row) => {
    if (row.stage === 'CLOSED') throw new HttpError(409, 'ILLEGAL_TRANSITION', 'This case is closed and can no longer be changed');
    if (row.coordinatorId === input.coordinatorId) return; // already the owner: nothing to do
    const next = await tx.user.findFirst({
      where: { id: input.coordinatorId, active: true, role: { in: [...ASSIGNEE_ROLES] } },
      select: { name: true },
    });
    if (!next) throw new HttpError(422, 'INVALID_REFERENCE', 'Unknown or inactive owner');
    await applyUpdate(tx, row, expectedVersion, { coordinatorId: input.coordinatorId });
    await audit(tx, auth, 'CASE_REASSIGNED', ref, `Named ownership transferred from ${row.coordinator.name} to ${next.name}.`);
  });

// ───────────────────────────── consent ─────────────────────────────

/**
 * Records or reverses a patient's opt-out. Append-only: an opt-out revokes every channel in one
 * batch; a restore re-grants only the channels the patient had actually granted before.
 * Idempotent: repeating the current state writes nothing.
 */
export async function setOptOut(auth: AuthContext, ref: string, optedOut: boolean): Promise<CaseDto> {
  const db = forOrg(auth.orgId);
  const now = new Date();
  return db.$transaction(async (tx) => {
    const row = await loadCase(tx, auth, ref);
    const rows = row.patient.consent; // newest first
    const currentlyOptedOut = toCaseDto(row, now).optedOut;
    if (currentlyOptedOut === optedOut) return toCaseDto(row, now);

    const at = nextConsentTime(rows, now);
    if (optedOut) {
      await recordOptOut(tx, { patientId: row.patientId, userId: auth.userId, at, basis: 'Patient opt-out; automated contact disabled, human coordinator only' });
      await audit(tx, auth, 'CONSENT_OPTOUT_RECORDED', ref, 'Patient opted out of automated SMS/WhatsApp; routed to human coordinator.');
    } else {
      const channels = restorableChannels(rows);
      if (channels.length === 0) {
        throw new HttpError(409, 'NO_PRIOR_CONSENT', 'The patient never gave consent for automated contact, so there is nothing to restore');
      }
      await recordRestore(tx, { patientId: row.patientId, channels, userId: auth.userId, at, basis: 'Patient confirmed they wish to be contacted again' });
      await audit(tx, auth, 'CONSENT_RESTORED', ref, 'Patient follow-up consent restored.');
    }
    return reload(tx, auth, ref, now);
  });
}

// ───────────────────────────── exports for CSV import ─────────────────────────────

export interface BulkItem {
  input: NewCaseInput & { patientCode: string };
  refs: ResolvedRefs;
}

/**
 * Creates many cases with a fixed number of queries (independent of batch size): lookups once,
 * reference numbers reserved in one statement, rows inserted in bulk, audit chain written in one pass.
 * Callers must already have rejected rows that would duplicate an open referral.
 * Returns the new reference numbers in input order.
 */
async function bulkInsertCases(tx: Tx, auth: AuthContext, items: BulkItem[], now: Date, batchAudit?: { detail: string; resourceId: string }): Promise<string[]> {
  if (items.length === 0) return [];

  // Patients: reuse existing codes, create the rest (one record per distinct new code).
  const codes = [...new Set(items.map((i) => i.input.patientCode))];
  const existing = await tx.patient.findMany({ where: { patientCode: { in: codes } }, select: { id: true, patientCode: true } });
  const patientIds = new Map(existing.map((p) => [p.patientCode, p.id]));
  const firstUse = new Map<string, NewCaseInput>();
  for (const i of items) if (!patientIds.has(i.input.patientCode) && !firstUse.has(i.input.patientCode)) firstUse.set(i.input.patientCode, i.input);
  if (firstUse.size > 0) {
    const created = await tx.patient.createManyAndReturn({
      data: [...firstUse].map(([code, input]) => {
        const name = input.patientName?.trim() || `Patient ${code}`;
        return {
          orgId: auth.orgId, patientCode: code, nameEnc: encryptField(name, aad.patientName(auth.orgId)),
          nameTokens: nameTokens(auth.orgId, name), label: input.patientLabel?.trim() || 'Screened',
          ...phoneColumns(auth.orgId, input.patientPhone),
        };
      }),
      select: { id: true, patientCode: true },
    });
    for (const p of created) patientIds.set(p.patientCode, p.id);
  }

  const refNumbers = await reserveRefNumbers(asAuditTx(tx), auth.orgId, items.length);
  const cases = await tx.referralCase.createManyAndReturn({
    data: items.map((i, n) => newCaseData(auth, i.input, i.refs, patientIds.get(i.input.patientCode)!, refNumbers[n], now)),
    select: { id: true, refNumber: true },
  });
  const idByRef = new Map(cases.map((c) => [c.refNumber, c.id]));

  await tx.caseMilestone.createMany({
    data: refNumbers.map((ref) => ({ caseId: idByRef.get(ref)!, type: 'REFERRAL_ISSUED' as const, occurredAt: now, recordedBy: auth.userId })),
  });
  const consent = items.filter((i) => i.input.consentSms).map((i) => consentRow(auth, i.input, patientIds.get(i.input.patientCode)!, now));
  if (consent.length > 0) await tx.consent.createMany({ data: consent });

  const actor = { orgId: auth.orgId, actorId: auth.userId, actorLabel: auth.name, actorRole: ROLE_LABELS[auth.role] };
  await appendAuditBatch(asAuditTx(tx), [
    ...items.map((i, n) => ({
      ...actor, action: 'CASE_CREATED', resourceType: 'ReferralCase', resourceId: refNumbers[n],
      detail: createdDetail(i.input, i.input.patientCode, i.refs.facilityName),
    })),
    ...(batchAudit ? [{ ...actor, action: 'CSV_BATCH_IMPORTED', resourceType: 'Batch', resourceId: batchAudit.resourceId, detail: batchAudit.detail }] : []),
  ]);
  return refNumbers;
}

export { insertCase, resolveRefs, bulkInsertCases };
export type { Tx };

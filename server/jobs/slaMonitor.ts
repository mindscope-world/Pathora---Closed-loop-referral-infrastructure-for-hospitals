import { Prisma } from '../db/generated/client';
import { env } from '../config/env';
import { prisma } from '../db/client';
import { HttpError } from '../lib/errors';
import { recordJobRun } from '../lib/metrics';
import { logger } from '../lib/logger';
import { SYSTEM_ACTOR } from '../lib/systemActor';
import { getMailer, notificationEmail } from '../lib/mailer';
import { appendAudit } from '../modules/audit/append';
import { hasMilestone } from '../modules/cases/dto';
import { appendNote } from '../modules/cases/service';
import { transition } from '../modules/cases/stateMachine';
import { parseRedFlagPolicy } from '../modules/rulepacks/rules';

/**
 * The SLA monitor: turns "a deadline passed" from something people have to notice into something that
 * is recorded and acted on.
 *
 *  - DEADLINE_PASSED: a referral's next-action deadline (`slaDueAt`) is in the past. The case already
 *    READS as Overdue (status is derived); the monitor records the breach once, audits it, and notifies.
 *  - RED_FLAG_UNACKNOWLEDGED: a red-flagged referral went unacknowledged longer than its pathway's
 *    structured red-flag timer. The monitor ESCALATES it (stage → Escalated) so a human must act.
 *
 * Each missed deadline is claimed by inserting a SlaBreach row whose (case, kind, deadline) is unique,
 * so it is handled exactly once no matter how often the monitor runs or how many instances run it.
 */
export { SYSTEM_ACTOR };
const HOUR_MS = 3_600_000;
const BATCH = 200;

export type BreachKind = 'DEADLINE_PASSED' | 'RED_FLAG_UNACKNOWLEDGED';

export interface Scope {
  orgId?: string;
  /** Restrict to these cases (used by the synthetic test so it never touches real referrals). */
  caseIds?: string[];
  /** Synthetic test fixtures are flagged and normally excluded from everything. */
  includeSynthetic?: boolean;
}

export interface PendingEmail {
  to: string;
  recipientName: string;
  title: string;
  body: string;
}

export interface Processed {
  kind: BreachKind;
  caseRef: string;
  notified: number;
  emails: PendingEmail[];
}

/** A concurrent human action changed the case between detection and processing; the next run retries. */
class StaleCase extends Error {}

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

// ───────────────────────────── detection ─────────────────────────────

export async function findCandidates(db: Db, now: Date, scope: Scope = {}): Promise<Array<{ caseId: string; kind: BreachKind }>> {
  const org = scope.orgId ? Prisma.sql`AND c."orgId" = ${scope.orgId}` : Prisma.empty;
  const ids = scope.caseIds ? Prisma.sql`AND c.id = ANY(${scope.caseIds})` : Prisma.empty;
  const synthetic = scope.includeSynthetic ? Prisma.empty : Prisma.sql`AND NOT c."isSynthetic"`;

  // Red-flag timers first, so a case that is both red-flagged and overdue is escalated before it is merely reported.
  // The CASE guards the numeric cast: a malformed policy yields NULL (no timer) instead of an error.
  const redFlag = await db.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM "ReferralCase" c
    JOIN "RulePack" p ON p.id = c."rulePackId"
    WHERE c."redFlag" AND c.stage NOT IN ('CLOSED', 'ESCALATED') ${synthetic} ${org} ${ids}
      AND NOT EXISTS (SELECT 1 FROM "CaseMilestone" m WHERE m."caseId" = c.id AND m.type = 'FACILITY_ACKNOWLEDGED')
      AND c."issuedAt" + make_interval(hours => (CASE WHEN jsonb_typeof(p."redFlagPolicy"->'unacknowledgedHours') = 'number'
            THEN (p."redFlagPolicy"->>'unacknowledgedHours')::int END)) < ${now}
      AND NOT EXISTS (
        SELECT 1 FROM "SlaBreach" b WHERE b."caseId" = c.id AND b.kind = 'RED_FLAG_UNACKNOWLEDGED'
          AND b.deadline = c."issuedAt" + make_interval(hours => (p."redFlagPolicy"->>'unacknowledgedHours')::int))
    ORDER BY c."issuedAt" LIMIT ${BATCH}`;

  const deadline = await db.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM "ReferralCase" c
    WHERE c.stage <> 'CLOSED' AND c."slaDueAt" < ${now} ${synthetic} ${org} ${ids}
      AND NOT EXISTS (SELECT 1 FROM "SlaBreach" b WHERE b."caseId" = c.id AND b.kind = 'DEADLINE_PASSED' AND b.deadline = c."slaDueAt")
    ORDER BY c."slaDueAt" LIMIT ${BATCH}`;

  return [
    ...redFlag.map((r) => ({ caseId: r.id, kind: 'RED_FLAG_UNACKNOWLEDGED' as const })),
    ...deadline.map((r) => ({ caseId: r.id, kind: 'DEADLINE_PASSED' as const })),
  ];
}

// ───────────────────────────── processing one breach ─────────────────────────────

const eat = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

function whatWasDue(stage: string, acked: boolean) {
  if (!acked) return 'Facility acknowledgment';
  return stage === 'ATTENDED' ? 'Outcome documentation' : 'The next required action';
}

/**
 * Records, audits and acts on one missed deadline, atomically. Returns null when there is nothing to do
 * (already handled, or the case moved on since detection). Must run inside a transaction.
 */
export async function processBreach(tx: Prisma.TransactionClient, caseId: string, kind: BreachKind, now: Date): Promise<Processed | null> {
  const c = await tx.referralCase.findUnique({
    where: { id: caseId },
    include: { rulePack: true, facility: { select: { name: true } }, milestones: { select: { type: true } } },
  });
  if (!c) return null;

  const acked = hasMilestone(c, 'FACILITY_ACKNOWLEDGED');
  let deadline: Date;
  let policyHours: number | null = null;

  if (kind === 'DEADLINE_PASSED') {
    if (c.stage === 'CLOSED' || c.slaDueAt >= now) return null; // closed or rescheduled since we looked
    deadline = c.slaDueAt;
  } else {
    policyHours = parseRedFlagPolicy(c.rulePack.redFlagPolicy).unacknowledgedHours;
    if (!c.redFlag || acked || c.stage === 'CLOSED' || c.stage === 'ESCALATED' || policyHours === null) return null;
    deadline = new Date(c.issuedAt.getTime() + policyHours * HOUR_MS);
    if (deadline >= now) return null;
    // Only escalate if the lifecycle allows it, and decide BEFORE claiming so an unescalatable case is not marked handled.
    try {
      transition({ stage: c.stage, hasAcknowledged: acked, hasAttended: hasMilestone(c, 'PATIENT_ATTENDED') }, 'ESCALATE');
    } catch (err) {
      if (err instanceof HttpError) return null;
      throw err;
    }
  }

  // Claim the missed deadline. Zero rows inserted means another run already handled it.
  const claimed = await tx.slaBreach.createMany({ data: [{ orgId: c.orgId, caseId: c.id, kind, deadline }], skipDuplicates: true });
  if (claimed.count !== 1) return null;

  const rule = `${c.rulePack.key} v${c.rulePack.version}`;
  let title: string;
  let body: string;
  if (kind === 'RED_FLAG_UNACKNOWLEDGED') {
    const note = `Red-flag referral not acknowledged within ${policyHours}h; escalated automatically`;
    const { count } = await tx.referralCase.updateMany({
      where: { id: c.id, version: c.version },
      data: { stage: 'ESCALATED', notes: appendNote(c.notes, 'Auto-escalated', note), version: { increment: 1 } },
    });
    if (count !== 1) throw new StaleCase(); // rolls back the claim; the next run sees the case as it now is
    title = `${c.refNumber}: red-flag referral escalated`;
    body = `A red-flag referral to ${c.facility.name} was not acknowledged within ${policyHours} hours and has been escalated for human follow-up.`;
    await appendAudit(tx, {
      orgId: c.orgId, ...SYSTEM_ACTOR, action: 'SLA_ESCALATION_TRIGGERED', resourceType: 'ReferralCase', resourceId: c.refNumber, at: now,
      detail: `Red-flag referral not acknowledged by ${c.facility.name} within ${policyHours}h; escalated for human follow-up (rule ${rule}).`,
    });
  } else {
    const late = Math.max(0, Math.floor((now.getTime() - deadline.getTime()) / HOUR_MS));
    title = `${c.refNumber} is overdue`;
    body = `${whatWasDue(c.stage, acked)} for the referral to ${c.facility.name} was due ${eat(deadline)} (${late}h ago). Open the referral to act.`;
    await appendAudit(tx, {
      orgId: c.orgId, ...SYSTEM_ACTOR, action: 'SLA_BREACH_DETECTED', resourceType: 'ReferralCase', resourceId: c.refNumber, at: now,
      detail: `${whatWasDue(c.stage, acked)} deadline passed ${late}h ago (due ${deadline.toISOString()}); facility ${c.facility.name} (rule ${rule}).`,
    });
  }

  // Who is told: the named owner, and the pack's clinical owner (or every active clinical lead if none is named).
  const recipients = await tx.user.findMany({
    where: {
      orgId: c.orgId, active: true,
      OR: [{ id: c.coordinatorId }, ...(c.rulePack.clinicalOwnerId ? [{ id: c.rulePack.clinicalOwnerId }] : [{ role: 'CLINICAL_LEAD' as const }])],
    },
    select: { id: true, name: true, email: true },
  });
  if (recipients.length > 0) {
    await tx.notification.createMany({
      data: recipients.map((u) => ({ orgId: c.orgId, userId: u.id, kind: kind === 'DEADLINE_PASSED' ? 'SLA_BREACH' : 'RED_FLAG_ESCALATION', title, body, caseRef: c.refNumber })),
    });
  }
  return {
    kind, caseRef: c.refNumber, notified: recipients.length,
    emails: recipients.map((u) => ({ to: u.email, recipientName: u.name, title, body })),
  };
}

// ───────────────────────────── the job ─────────────────────────────

export interface MonitorSummary {
  deadlineBreaches: number;
  redFlagEscalations: number;
  notifications: number;
  emailsSent: number;
  errors: number;
}

export async function sendEmails(emails: PendingEmail[]): Promise<number> {
  const mailer = getMailer();
  if (!mailer.configured || emails.length === 0) return 0;
  const appUrl = new URL(env.APP_URL).origin;
  let sent = 0;
  for (const e of emails) {
    try {
      await mailer.send(notificationEmail({ ...e, appUrl }));
      sent++;
    } catch (err) {
      logger.error({ err, to: '[redacted]' }, 'Could not send SLA notification email'); // in-app notification still exists
    }
  }
  return sent;
}

/** One pass over every organisation (or just `scope.orgId`). Safe to run concurrently and repeatedly. */
export async function runSlaMonitor(now: Date = new Date(), scope: Pick<Scope, 'orgId'> = {}): Promise<MonitorSummary> {
  const summary: MonitorSummary = { deadlineBreaches: 0, redFlagEscalations: 0, notifications: 0, emailsSent: 0, errors: 0 };
  const emails: PendingEmail[] = [];

  for (const cand of await findCandidates(prisma, now, scope)) {
    try {
      const done = await prisma.$transaction((tx) => processBreach(tx, cand.caseId, cand.kind, now), { timeout: 15_000 });
      if (!done) continue;
      if (done.kind === 'DEADLINE_PASSED') summary.deadlineBreaches++;
      else summary.redFlagEscalations++;
      summary.notifications += done.notified;
      emails.push(...done.emails);
    } catch (err) {
      if (err instanceof StaleCase) continue; // someone just changed the case; the next run handles it
      summary.errors++;
      logger.error({ err, caseId: cand.caseId, kind: cand.kind }, 'SLA monitor could not process a case');
    }
  }
  summary.emailsSent = await sendEmails(emails);
  if (summary.deadlineBreaches + summary.redFlagEscalations > 0) logger.info(summary, 'SLA monitor recorded breaches');
  return summary;
}

/** Starts the periodic run; returns a function that stops it. */
export function startSlaMonitor(intervalSeconds = Number(process.env.SLA_MONITOR_INTERVAL_SECONDS) || 120): () => void {
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap runs
    running = true;
    try {
      await runSlaMonitor();
      recordJobRun('sla_monitor', true);
    } catch (err) {
      recordJobRun('sla_monitor', false);
      logger.error({ err }, 'SLA monitor run failed');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 5_000); // soon after boot, so a restart catches up on anything missed
  const timer = setInterval(tick, intervalSeconds * 1000);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}


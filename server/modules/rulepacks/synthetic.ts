import { randomBytes } from 'node:crypto';
import { PATHWAY_LABELS, ROLE_LABELS, type SyntheticCheck, type SyntheticTestResponse } from '../../../shared/types';
import { finalizeResult, finalizeStop, preSend } from '../../jobs/messageWorker';
import { findCandidates, processBreach } from '../../jobs/slaMonitor';
import { prisma } from '../../db/client';
import type { Prisma } from '../../db/generated/client';
import { forOrg } from '../../db/tenant';
import { aad, encryptField } from '../../lib/crypto';
import { HttpError } from '../../lib/errors';
import type { AuthContext } from '../../types';
import { appendAudit } from '../audit/append';
import { caseInclude, type CaseRow } from '../cases/dto';
import { ackDeadline, evaluationDeadline } from '../cases/sla';
import { MAX_ATTEMPTS } from '../comms/schedule';
import { parseRedFlagPolicy } from './rules';

/** Always thrown at the end of the run so the transaction rolls back: nothing a scenario does is ever saved. */
class Rollback extends Error {}

const HOUR_MS = 3_600_000;

/**
 * The go-live gate for a pathway: runs the REAL SLA-monitor code against fixture referrals built from the
 * pack's own timers, and reports what actually happened. Every check can fail.
 *
 * Isolation: the whole scenario runs inside one transaction that is rolled back, the fixtures are also
 * flagged `isSynthetic` (excluded from every metric and export), and the monitor is scoped to the fixture
 * ids so it can never touch a real referral. After the rollback the run verifies nothing was left behind.
 */
export async function runSyntheticTest(auth: AuthContext, key: string): Promise<SyntheticTestResponse> {
  const db = forOrg(auth.orgId);
  const pack = await db.rulePack.findFirst({ where: { key }, orderBy: { version: 'desc' } });
  if (!pack) throw HttpError.notFound('Rule pack not found');
  const facility = await db.facility.findFirst({ select: { id: true } });
  if (!facility) throw new HttpError(422, 'NO_FACILITY', 'Add a receiving facility before running the gate test');

  const marker = `SYN-${randomBytes(4).toString('hex').toUpperCase()}`;
  const now = new Date();
  const checks: SyntheticCheck[] = [];
  const check = async (id: string, title: string, fn: () => Promise<Omit<SyntheticCheck, 'id' | 'title'>>) => {
    try {
      checks.push({ id, title, ...(await fn()) });
    } catch (err) {
      checks.push({ id, title, outcome: 'FAILED', detail: `The check could not complete: ${err instanceof Error ? err.message : 'unexpected error'}` });
    }
  };

  try {
    await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.create({
        data: { orgId: auth.orgId, patientCode: `${marker}-P`, nameEnc: encryptField('Synthetic Test Patient', aad.patientName(auth.orgId)), nameTokens: [], label: 'Synthetic' },
      });

      /** A fixture referral issued `hoursAgo`, created exactly as a real one would be under this pack. */
      const fixture = async (tag: string, hoursAgo: number, opts: { redFlag?: boolean; closed?: boolean; patientId?: string } = {}) => {
        const issuedAt = new Date(now.getTime() - hoursAgo * HOUR_MS);
        const refNumber = `${marker}-${tag}`;
        const row = await tx.referralCase.create({
          data: {
            refNumber, orgId: auth.orgId, patientId: opts.patientId ?? patient.id, pathway: pack.pathway, rulePackId: pack.id, sourceProgram: 'Synthetic gate test',
            coordinatorId: auth.userId, facilityId: facility.id, redFlag: opts.redFlag ?? false, isSynthetic: true,
            stage: opts.closed ? 'CLOSED' : 'HANDOFF_SENT', issuedAt, slaDueAt: ackDeadline(issuedAt, pack), dueDate: evaluationDeadline(issuedAt, pack),
            ...(opts.closed ? { closedAt: now, closureReason: 'Synthetic closure', outcomeSource: 'Synthetic gate test' } : {}),
          },
        });
        await tx.caseMilestone.create({ data: { caseId: row.id, type: 'REFERRAL_ISSUED', occurredAt: issuedAt } });
        return row;
      };
      const scope = (ids: string[]) => ({ orgId: auth.orgId, caseIds: ids, includeSynthetic: true });
      const audited = (ref: string, action: string) => tx.auditEvent.findFirst({ where: { orgId: auth.orgId, resourceId: ref, action }, select: { id: true } });
      const notified = (ref: string) => tx.notification.findFirst({ where: { orgId: auth.orgId, userId: auth.userId, caseRef: ref }, select: { id: true } });

      // 1 ── which rules will new referrals pick up?
      await check('new-referrals', 'New referrals use this version', async () => {
        const current = await tx.rulePack.findFirst({ where: { orgId: auth.orgId, pathway: pack.pathway }, orderBy: { version: 'desc' } });
        if (pack.status === 'COMING_SOON') return { outcome: 'SKIPPED', detail: 'This pathway is marked Coming Soon, so it is not accepting referrals yet.' };
        if (current?.id !== pack.id) return { outcome: 'FAILED', detail: `New ${PATHWAY_LABELS[pack.pathway]} referrals would use a different rule pack (${current?.key} v${current?.version}).` };
        return { outcome: 'PASSED', detail: `New ${PATHWAY_LABELS[pack.pathway]} referrals use ${pack.key} v${pack.version}: acknowledgment within ${pack.ackSlaHours}h, evaluation within ${pack.evalTargetDays} days.` };
      });

      // 2 ── a missed acknowledgment deadline is detected, audited, and the owner is told
      const overdue = await fixture('ACK', pack.ackSlaHours + 1);
      await check('ack-overdue', `Unacknowledged referral past ${pack.ackSlaHours}h is detected`, async () => {
        const found = (await findCandidates(tx, now, scope([overdue.id]))).find((c) => c.caseId === overdue.id && c.kind === 'DEADLINE_PASSED');
        if (!found) return { outcome: 'FAILED', detail: 'The monitor did not flag a referral whose acknowledgment deadline had passed.' };
        const result = await processBreach(tx, overdue.id, 'DEADLINE_PASSED', now);
        const recorded = (await tx.slaBreach.count({ where: { caseId: overdue.id, kind: 'DEADLINE_PASSED' } })) === 1;
        const gaveAudit = Boolean(await audited(overdue.refNumber, 'SLA_BREACH_DETECTED'));
        const toldOwner = Boolean(await notified(overdue.refNumber));
        const missing = [!result && 'no result', !recorded && 'breach not recorded', !gaveAudit && 'no audit entry', !toldOwner && 'owner not notified'].filter(Boolean);
        return missing.length
          ? { outcome: 'FAILED', detail: `Detected, but: ${missing.join(', ')}.` }
          : { outcome: 'PASSED', detail: `A referral ${pack.ackSlaHours + 1}h old with no acknowledgment was recorded as a breach, audited, and the named owner was notified.` };
      });

      await check('idempotent', 'The same breach is reported only once', async () => {
        const again = (await findCandidates(tx, now, scope([overdue.id]))).some((c) => c.caseId === overdue.id && c.kind === 'DEADLINE_PASSED');
        const twice = await processBreach(tx, overdue.id, 'DEADLINE_PASSED', now);
        return again || twice
          ? { outcome: 'FAILED', detail: 'Running the monitor a second time reported the same missed deadline again.' }
          : { outcome: 'PASSED', detail: 'Running the monitor again did not repeat the alert, so people are not spammed every few minutes.' };
      });

      // 3 ── the structured red-flag rule
      const hours = parseRedFlagPolicy(pack.redFlagPolicy).unacknowledgedHours;
      if (hours === null) {
        const detail = 'No red-flag timer is configured for this pathway, so red flags are not escalated automatically.';
        checks.push({ id: 'red-flag', title: 'Red-flag referral is escalated on time', outcome: 'SKIPPED', detail });
        checks.push({ id: 'red-flag-boundary', title: 'Red-flag referral inside the window is left alone', outcome: 'SKIPPED', detail });
      } else {
        const late = await fixture('RF-LATE', hours + 1, { redFlag: true });
        await check('red-flag', `Red-flag referral unacknowledged past ${hours}h is escalated`, async () => {
          const found = (await findCandidates(tx, now, scope([late.id]))).some((c) => c.caseId === late.id && c.kind === 'RED_FLAG_UNACKNOWLEDGED');
          if (!found) return { outcome: 'FAILED', detail: 'The monitor did not flag a red-flag referral that exceeded its timer.' };
          await processBreach(tx, late.id, 'RED_FLAG_UNACKNOWLEDGED', now);
          const stage = (await tx.referralCase.findUniqueOrThrow({ where: { id: late.id }, select: { stage: true } })).stage;
          const missing = [stage !== 'ESCALATED' && `stage is ${stage}, not ESCALATED`, !(await audited(late.refNumber, 'SLA_ESCALATION_TRIGGERED')) && 'no audit entry', !(await notified(late.refNumber)) && 'owner not notified'].filter(Boolean);
          return missing.length
            ? { outcome: 'FAILED', detail: `Detected, but: ${missing.join(', ')}.` }
            : { outcome: 'PASSED', detail: `A red-flag referral unacknowledged for ${hours + 1}h was escalated automatically for human follow-up, audited, and the owner was notified.` };
        });

        const early = await fixture('RF-EARLY', hours / 2, { redFlag: true });
        await check('red-flag-boundary', `Red-flag referral inside the ${hours}h window is left alone`, async () => {
          const flagged = (await findCandidates(tx, now, scope([early.id]))).some((c) => c.caseId === early.id && c.kind === 'RED_FLAG_UNACKNOWLEDGED');
          return flagged
            ? { outcome: 'FAILED', detail: 'The monitor escalated a red-flag referral before its timer expired.' }
            : { outcome: 'PASSED', detail: `A red-flag referral ${hours / 2}h old (inside the ${hours}h window) was not escalated early.` };
        });
      }

      // 4 ── closing a referral with a documented outcome
      const done = await fixture('CLOSED', pack.evalTargetDays * 24 + 48, { closed: true });
      await check('closure', 'A closed referral is never flagged overdue', async () => {
        const flagged = (await findCandidates(tx, now, scope([done.id]))).some((c) => c.caseId === done.id);
        return flagged
          ? { outcome: 'FAILED', detail: 'The monitor flagged a closed referral as overdue.' }
          : { outcome: 'PASSED', detail: 'A referral closed with a documented outcome and a long-past deadline was not flagged.' };
      });

      // 5 ── patient messaging safeguards (the same functions the live worker uses)
      // A fixture number (never hashed, so it can never be matched to a real patient's reply) lets the "reachable" baseline hold.
      const mkPatient = (suffix: string, withPhone = false) =>
        tx.patient.create({
          data: {
            orgId: auth.orgId, patientCode: `${marker}-${suffix}`, nameEnc: encryptField('Synthetic Test Patient', aad.patientName(auth.orgId)), nameTokens: [], label: 'Synthetic',
            ...(withPhone ? { phoneEnc: encryptField('+254700000000', aad.patientPhone(auth.orgId)) } : {}),
          },
        });
      const sending = (c: { id: string; patientId: string }) =>
        tx.commsLog.create({ data: { orgId: auth.orgId, caseId: c.id, patientId: c.patientId, channel: 'SMS', templateName: 'Synthetic gate test', body: 'Synthetic message', status: 'SENDING', attempts: 1, requestedById: auth.userId } });
      const full = async (id: string) => (await tx.referralCase.findUniqueOrThrow({ where: { id }, include: caseInclude })) as CaseRow;
      const toldOwner = (ref: string) => tx.notification.findFirst({ where: { orgId: auth.orgId, userId: auth.userId, caseRef: ref, kind: 'HUMAN_FOLLOW_UP' }, select: { id: true } });

      await check('consent-block', 'A patient who opted out is never messaged', async () => {
        const p = await mkPatient('OPT', true);
        const c = await fixture('OPT', 1, { patientId: p.id });
        const at = new Date(now.getTime() - 3_600_000);
        await tx.consent.create({ data: { patientId: p.id, channel: 'SMS', granted: true, event: 'CAPTURED', lawfulBasis: 'Synthetic', recordedAt: at } });
        const log = await sending(c);
        const allowed = preSend(log, await full(c.id));
        if (allowed.action !== 'SEND' && allowed.status === 'HUMAN_ROUTED') return { outcome: 'SKIPPED', detail: `Could not test consent: ${allowed.reason}` };
        if (allowed.action === 'STOP' && allowed.status === 'BLOCKED_OPTOUT') return { outcome: 'FAILED', detail: 'A patient who HAD consented was treated as opted out.' };

        for (const channel of ['SMS', 'WHATSAPP', 'VOICE'] as const) {
          await tx.consent.create({ data: { patientId: p.id, channel, granted: false, event: 'OPTED_OUT', lawfulBasis: 'Synthetic opt-out', recordedAt: now } });
        }
        const after = await full(c.id);
        const gate = preSend(log, after);
        if (gate.action !== 'STOP' || gate.status !== 'BLOCKED_OPTOUT') return { outcome: 'FAILED', detail: 'A queued message to a patient who had just opted out was NOT stopped.' };
        await finalizeStop(tx, log, after, gate, now);
        const row = await tx.commsLog.findUniqueOrThrow({ where: { id: log.id } });
        const missing = [row.status !== 'BLOCKED_OPTOUT' && `status is ${row.status}`, !(await audited(c.refNumber, 'MESSAGE_BLOCKED_OPTOUT')) && 'no audit entry', !(await toldOwner(c.refNumber)) && 'owner not told'].filter(Boolean);
        return missing.length
          ? { outcome: 'FAILED', detail: `The message was stopped, but: ${missing.join(', ')}.` }
          : { outcome: 'PASSED', detail: 'A queued message to a patient who then opted out was stopped at the last moment, audited, and the case owner was asked to call the patient.' };
      });

      await check('contact-fallback', 'An undeliverable message is handed to a person', async () => {
        const p = await mkPatient('NOPHONE');
        await tx.consent.create({ data: { patientId: p.id, channel: 'SMS', granted: true, event: 'CAPTURED', lawfulBasis: 'Synthetic', recordedAt: new Date(now.getTime() - 3_600_000) } });
        const noPhone = await fixture('NOPHONE', 1, { patientId: p.id });
        const noPhoneLog = await sending(noPhone);
        const gate = preSend(noPhoneLog, await full(noPhone.id));
        if (gate.action !== 'STOP' || gate.status !== 'HUMAN_ROUTED') return { outcome: 'FAILED', detail: 'A patient with no mobile number on file was not handed to a person.' };
        await finalizeStop(tx, noPhoneLog, await full(noPhone.id), gate, now);

        const failing = await fixture('FAILING', 1, { patientId: p.id });
        const exhausted = await tx.commsLog.create({ data: { orgId: auth.orgId, caseId: failing.id, patientId: p.id, channel: 'SMS', templateName: 'Synthetic gate test', body: 'x', status: 'SENDING', attempts: MAX_ATTEMPTS } });
        const retrying = await tx.commsLog.create({ data: { orgId: auth.orgId, caseId: failing.id, patientId: p.id, channel: 'SMS', templateName: 'Synthetic gate test', body: 'x', status: 'SENDING', attempts: 1 } });
        const down = { ok: false as const, transient: true, reason: 'The messaging provider is unavailable' };
        const soon = await finalizeResult(tx, retrying, await full(failing.id), down, now);
        const gaveUp = await finalizeResult(tx, exhausted, await full(failing.id), down, now);

        const rows = await tx.commsLog.findMany({ where: { id: { in: [retrying.id, exhausted.id] } } });
        const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
        const missing = [
          (soon !== 'RETRY' || byId[retrying.id].status !== 'QUEUED' || !byId[retrying.id].nextAttemptAt) && 'a temporary failure was not scheduled for retry',
          (gaveUp !== 'FAILED' || byId[exhausted.id].status !== 'FAILED') && 'a message that kept failing was not marked failed',
          !(await audited(failing.refNumber, 'MESSAGE_FAILED')) && 'the failure was not audited',
          !(await toldOwner(failing.refNumber)) && 'no person was told',
          !(await toldOwner(noPhone.refNumber)) && 'a missing number did not alert a person',
        ].filter(Boolean);
        return missing.length
          ? { outcome: 'FAILED', detail: `${missing.join('; ')}.` }
          : { outcome: 'PASSED', detail: `A patient with no number, and a message that failed ${MAX_ATTEMPTS} times, were both handed to the case owner; a temporary failure was retried instead.` };
      });

      throw new Rollback();
    }, { timeout: 30_000 });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }

  // 5 ── prove nothing was saved (checked AFTER the rollback, outside the transaction)
  await check('isolation', 'Nothing from this run was saved', async () => {
    const left = {
      referrals: await prisma.referralCase.count({ where: { refNumber: { startsWith: marker } } }),
      patients: await prisma.patient.count({ where: { patientCode: { startsWith: marker } } }),
      auditEvents: await prisma.auditEvent.count({ where: { resourceId: { startsWith: marker } } }),
      notifications: await prisma.notification.count({ where: { caseRef: { startsWith: marker } } }),
      messages: await prisma.commsLog.count({ where: { templateName: 'Synthetic gate test' } }),
      consent: await prisma.consent.count({ where: { patient: { patientCode: { startsWith: marker } } } }),
    };
    const total = Object.values(left).reduce((a, b) => a + b, 0);
    return total === 0
      ? { outcome: 'PASSED', detail: 'The scenarios were rolled back: live referrals, the audit trail, notifications and programme metrics are untouched.' }
      : { outcome: 'FAILED', detail: `Synthetic data was left behind: ${JSON.stringify(left)}.` };
  });

  const passed = checks.every((c) => c.outcome !== 'FAILED');
  const tally = (o: SyntheticCheck['outcome']) => checks.filter((c) => c.outcome === o).length;

  // The run itself is recorded, as evidence that this version was tested before go-live.
  await prisma.$transaction((tx) =>
    appendAudit(tx as Prisma.TransactionClient, {
      orgId: auth.orgId, actorId: auth.userId, actorLabel: auth.name, actorRole: ROLE_LABELS[auth.role],
      action: 'RULE_PACK_GATE_TESTED', resourceType: 'RulePack', resourceId: pack.key,
      detail: `Ran the synthetic gate test on ${pack.key} v${pack.version}: ${tally('PASSED')} passed, ${tally('FAILED')} failed, ${tally('SKIPPED')} skipped.`,
    }),
  );

  return { rulePack: { id: pack.key, name: pack.name, version: pack.version }, ranAt: now.toISOString(), passed, checks };
}


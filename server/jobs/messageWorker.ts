import { CHANNEL_LABELS } from '../../shared/types';
import { prisma } from '../db/client';
import type { CommsLog, Prisma } from '../db/generated/client';
import { decryptField, aad } from '../lib/crypto';
import { clock } from '../lib/clock';
import { recordJobRun } from '../lib/metrics';
import { logger } from '../lib/logger';
import { maskPhone } from '../lib/phone';
import { MESSAGING_ACTOR } from '../lib/systemActor';
import { MockProvider } from '../messaging/mock';
import { getProvider, type SendResult } from '../messaging/provider';
import { appendAudit } from '../modules/audit/append';
import { caseInclude, consentState, type CaseRow } from '../modules/cases/dto';
import { routeToHuman } from '../modules/comms/humanRoute';
import { consentBlock } from '../modules/comms/messages';
import { nextRetryTime } from '../modules/comms/schedule';
import { applyDeliveryReceipt } from '../modules/comms/webhooks';

/**
 * Delivers queued patient messages. Like the export worker, the CommsLog table IS the queue: rows are claimed
 * with FOR UPDATE SKIP LOCKED, so several server instances can run this without sending anything twice.
 *
 * Principles:
 *  - Consent is checked AGAIN at the moment of sending. A patient can reply STOP between queueing and sending.
 *  - A message that cannot be delivered goes to a PERSON (a notification to the case owner), never silently away.
 *  - A missed reminder is better than a duplicate one. If a worker dies mid-send we cannot know whether the
 *    provider accepted the message, so it is marked failed for a person to check, not retried.
 */
export const STALE_SENDING_MS = 10 * 60_000;
const POLL_MS = 10_000;

type Db = Pick<Prisma.TransactionClient, 'commsLog' | 'notification' | 'user' | '$executeRaw' | 'auditEvent'>;

/** Atomically takes the oldest message that is due, marking it SENDING. */
export async function claimNext(now: Date = clock()): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "CommsLog" SET status = 'SENDING', attempts = attempts + 1, "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "CommsLog" WHERE status = 'QUEUED' AND "nextAttemptAt" <= ${now}
      ORDER BY "nextAttemptAt" FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING id`;
  return rows[0]?.id ?? null;
}

export type PreSend =
  | { action: 'SEND'; phone: string; text: string }
  | { action: 'STOP'; status: 'BLOCKED_OPTOUT' | 'HUMAN_ROUTED' | 'FAILED'; reason: string; notify: boolean };

/** The last gate before a message leaves: is it still allowed, and can it be delivered? */
export function preSend(log: CommsLog, c: CaseRow): PreSend {
  if (c.stage === 'CLOSED') return { action: 'STOP', status: 'FAILED', reason: 'The referral was closed before this message was sent.', notify: false };
  const channel = log.channel as 'SMS' | 'WHATSAPP';
  const blocked = consentBlock(consentState(c.patient.consent), channel);
  if (blocked) return { action: 'STOP', status: 'BLOCKED_OPTOUT', reason: `Consent was withdrawn before the message was sent. ${blocked}`, notify: true };
  if (!getProvider().supports(channel)) return { action: 'STOP', status: 'HUMAN_ROUTED', reason: `${CHANNEL_LABELS[channel]} is not available yet.`, notify: true };
  if (!c.patient.phoneEnc) return { action: 'STOP', status: 'HUMAN_ROUTED', reason: 'There is no mobile number on file for this patient.', notify: true };
  if (!log.body) return { action: 'STOP', status: 'FAILED', reason: 'The message had no text to send.', notify: true };
  return { action: 'SEND', phone: decryptField(c.patient.phoneEnc, aad.patientPhone(c.orgId)), text: log.body };
}

const actions: Record<'BLOCKED_OPTOUT' | 'HUMAN_ROUTED' | 'FAILED', string> = {
  BLOCKED_OPTOUT: 'MESSAGE_BLOCKED_OPTOUT', HUMAN_ROUTED: 'MESSAGE_HUMAN_ROUTED', FAILED: 'MESSAGE_FAILED',
};

/** Ends a message without sending it, recording why and (usually) telling a person. */
export async function finalizeStop(tx: Db, log: CommsLog, c: Pick<CaseRow, 'orgId' | 'coordinatorId' | 'refNumber'>, stop: Extract<PreSend, { action: 'STOP' }>, now: Date) {
  await tx.commsLog.update({ where: { id: log.id }, data: { status: stop.status, failureReason: stop.reason, nextAttemptAt: null } });
  await appendAudit(tx as Prisma.TransactionClient, {
    orgId: c.orgId, ...MESSAGING_ACTOR, action: actions[stop.status], resourceType: 'ReferralCase', resourceId: c.refNumber, at: now,
    detail: `${CHANNEL_LABELS[log.channel as 'SMS']} "${log.templateName}" was not sent: ${stop.reason}`,
  });
  if (stop.notify) await routeToHuman(tx, c, stop.reason);
}

/** Applies the provider's answer: sent, retry later, or give up and tell a person. */
export async function finalizeResult(tx: Db, log: CommsLog, c: Pick<CaseRow, 'orgId' | 'coordinatorId' | 'refNumber'>, result: SendResult, now: Date) {
  const label = `${CHANNEL_LABELS[log.channel as 'SMS']} "${log.templateName}"`;
  if (result.ok) {
    await tx.commsLog.update({ where: { id: log.id }, data: { status: 'SENT', providerMessageId: result.providerMessageId, sentAt: now, failureReason: null, nextAttemptAt: null } });
    await appendAudit(tx as Prisma.TransactionClient, { orgId: c.orgId, ...MESSAGING_ACTOR, action: 'MESSAGE_SENT', resourceType: 'ReferralCase', resourceId: c.refNumber, at: now, detail: `Sent ${label} (attempt ${log.attempts}).` });
    return 'SENT' as const;
  }
  const retryAt = result.transient ? nextRetryTime(log.attempts, now) : null;
  if (retryAt) {
    await tx.commsLog.update({ where: { id: log.id }, data: { status: 'QUEUED', nextAttemptAt: retryAt, failureReason: result.reason } });
    return 'RETRY' as const;
  }
  const reason = result.transient ? `${result.reason}. Gave up after ${log.attempts} attempts.` : `${result.reason}.`;
  await tx.commsLog.update({ where: { id: log.id }, data: { status: 'FAILED', failureReason: reason, nextAttemptAt: null } });
  await appendAudit(tx as Prisma.TransactionClient, { orgId: c.orgId, ...MESSAGING_ACTOR, action: 'MESSAGE_FAILED', resourceType: 'ReferralCase', resourceId: c.refNumber, at: now, detail: `${label} could not be delivered: ${reason}` });
  await routeToHuman(tx, c, `The message could not be delivered (${reason.replace(/\.$/, '')}).`);
  return 'FAILED' as const;
}

/** Delivers one claimed message. */
export async function dispatch(logId: string, now: Date = clock()): Promise<'SENT' | 'RETRY' | 'FAILED' | 'STOPPED'> {
  const log = await prisma.commsLog.findUniqueOrThrow({ where: { id: logId } });
  const c = (await prisma.referralCase.findUniqueOrThrow({ where: { id: log.caseId }, include: caseInclude })) as CaseRow;

  const gate = preSend(log, c);
  if (gate.action === 'STOP') {
    await prisma.$transaction((tx) => finalizeStop(tx, log, c, gate, now));
    return 'STOPPED';
  }

  // The network call happens OUTSIDE any database transaction.
  const provider = getProvider();
  let result: SendResult;
  try {
    result = await provider.send({ to: gate.phone, text: gate.text, channel: log.channel as 'SMS' | 'WHATSAPP', reference: log.id });
  } catch (err) {
    logger.error({ err, logId, to: maskPhone(gate.phone) }, 'Messaging provider threw');
    result = { ok: false, transient: true, reason: 'The messaging provider failed unexpectedly' };
  }
  const outcome = await prisma.$transaction((tx) => finalizeResult(tx, log, c, result, now));
  return outcome;
}

export async function processDue(max = 50, now: Date = clock()): Promise<number> {
  let n = 0;
  while (n < max) {
    const id = await claimNext(now);
    if (!id) break;
    try {
      await dispatch(id, now);
    } catch (err) {
      // Left SENDING; recoverStale() will hand it to a person.
      logger.error({ err, logId: id }, 'Message dispatch failed');
    }
    n++;
  }
  return n;
}

/**
 * A message stuck in SENDING means a worker died mid-send. We cannot tell whether the provider accepted it, and
 * resending risks a duplicate to a patient, so it is marked failed and a person is asked to check.
 */
export async function recoverStale(now: Date = clock(), staleMs = STALE_SENDING_MS): Promise<number> {
  const stuck = await prisma.commsLog.findMany({ where: { status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - staleMs) } }, include: { case: true } });
  for (const log of stuck) {
    const reason = 'Sending was interrupted, so it is not known whether this message reached the patient. Please check with them directly.';
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.commsLog.updateMany({ where: { id: log.id, status: 'SENDING' }, data: { status: 'FAILED', failureReason: reason } });
      if (count !== 1) return;
      await appendAudit(tx, { orgId: log.orgId, ...MESSAGING_ACTOR, action: 'MESSAGE_FAILED', resourceType: 'ReferralCase', resourceId: log.case.refNumber, at: now, detail: `${CHANNEL_LABELS[log.channel as 'SMS']} "${log.templateName}": ${reason}` });
      await routeToHuman(tx, log.case, reason);
    });
  }
  return stuck.length;
}

/** Fire-and-forget: start delivering what is due right now (used right after queueing). */
export function kickMessageWorker() {
  void processDue().catch((err) => logger.error({ err }, 'Message run failed'));
}

export function startMessageWorker(): () => void {
  // Development convenience: the mock provider plays back the receipts a real one would post.
  const provider = getProvider();
  if (provider instanceof MockProvider && process.env.NODE_ENV === 'development') {
    provider.onSent = (_m, id) => {
      setTimeout(() => void applyDeliveryReceipt({ providerMessageId: id, status: 'DELIVERED' }).catch(() => undefined), 2_000).unref();
      setTimeout(() => void applyDeliveryReceipt({ providerMessageId: id, status: 'READ' }).catch(() => undefined), 6_000).unref();
    };
  }
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await recoverStale();
      await processDue();
      recordJobRun('message_worker', true);
    } catch (err) {
      recordJobRun('message_worker', false);
      logger.error({ err }, 'Message worker tick failed');
    } finally {
      running = false;
    }
  }, POLL_MS);
  timer.unref();
  return () => clearInterval(timer);
}


import { createHash, timingSafeEqual } from 'node:crypto';
import { CHANNEL_LABELS, type DeliveryStatusId } from '../../../shared/types';
import { env } from '../../config/env';
import { prisma } from '../../db/client';
import type { InboundKind, Prisma } from '../../db/generated/client';
import { PATIENT_ACTOR, MESSAGING_ACTOR } from '../../lib/systemActor';
import { normalizePhone, phoneHash } from '../../lib/phone';
import { logger } from '../../lib/logger';
import { appendAudit } from '../audit/append';
import { consentState } from '../cases/dto';
import { nextConsentTime, recordOptOut, recordRestore, restorableChannels } from '../consent/consent';
import { routeToHuman } from './humanRoute';
import { classifyReply } from './keywords';

// ───────────────────────────── authenticating the provider ─────────────────────────────

/** Constant-time comparison of the shared secret the provider puts on its callback URLs. */
export function webhookSecretMatches(given: string | undefined): boolean {
  const expected = env.MESSAGING_WEBHOOK_SECRET;
  if (!expected || !given) return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(given).digest();
  return timingSafeEqual(a, b);
}
export const webhooksConfigured = () => Boolean(env.MESSAGING_WEBHOOK_SECRET);

// ───────────────────────────── delivery receipts ─────────────────────────────

/** A provider's own wording → ours. Unknown words are ignored rather than guessed at. */
const PROVIDER_STATUS: Record<string, DeliveryStatusId> = {
  sent: 'SENT', submitted: 'SENT', buffered: 'SENT', queued: 'SENT', accepted: 'SENT',
  success: 'DELIVERED', delivered: 'DELIVERED', deliveredtoterminal: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED', rejected: 'FAILED', undelivered: 'FAILED', expired: 'FAILED',
};

/** How far along a message is. A receipt may only move it forward: a late "sent" must not undo "delivered". */
const RANK: Partial<Record<DeliveryStatusId, number>> = { QUEUED: 0, SENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 };

export function mapProviderStatus(raw: string): DeliveryStatusId | null {
  return PROVIDER_STATUS[raw.toLowerCase().replace(/[^a-z]/g, '')] ?? null;
}

export async function applyDeliveryReceipt(r: { providerMessageId: string; status: string; failureReason?: string }): Promise<{ matched: boolean; changed: boolean }> {
  const next = mapProviderStatus(r.status);
  if (!next) return { matched: false, changed: false };

  return prisma.$transaction(async (tx) => {
    const log = await tx.commsLog.findFirst({ where: { providerMessageId: r.providerMessageId }, include: { case: true } });
    if (!log) return { matched: false, changed: false };

    const from = RANK[log.status as DeliveryStatusId];
    if (next === 'FAILED') {
      // A provider can report failure after accepting; but not after the patient's phone confirmed receipt.
      if (log.status === 'DELIVERED' || log.status === 'READ' || log.status === 'FAILED') return { matched: true, changed: false };
      const reason = r.failureReason ? `The network reported: ${r.failureReason.slice(0, 120)}.` : 'The network reported that the message was not delivered.';
      await tx.commsLog.update({ where: { id: log.id }, data: { status: 'FAILED', failureReason: reason } });
      await appendAudit(tx, { orgId: log.orgId, ...MESSAGING_ACTOR, action: 'MESSAGE_FAILED', resourceType: 'ReferralCase', resourceId: log.case.refNumber, detail: `${CHANNEL_LABELS[log.channel as 'SMS']} "${log.templateName}" was not delivered. ${reason}` });
      await routeToHuman(tx, log.case, 'The message was not delivered to the patient.');
      return { matched: true, changed: true };
    }
    if (from === undefined || RANK[next]! <= from) return { matched: true, changed: false }; // stale, duplicate or out-of-order
    // Optimistic: only move it if nobody changed it since we read it.
    const { count } = await tx.commsLog.updateMany({ where: { id: log.id, status: log.status }, data: { status: next } });
    return { matched: true, changed: count === 1 };
  });
}

// ───────────────────────────── inbound replies ─────────────────────────────

export interface InboundResult {
  /** Patients (across all programmes) whose number matched. */
  matched: number;
  kind: InboundKind;
  actedOn: number;
}

/**
 * A patient replied to an automated message. We work out what they MEANT and act on it; the text is never
 * stored. STOP applies to every programme that has been messaging that number (a person's right to stop
 * should not depend on which programme texted them); everything else concerns the most recently messaged referral.
 */
export async function applyInboundReply(r: { from: string; text: string; providerMessageId: string }): Promise<InboundResult> {
  const kind = classifyReply(r.text);
  const e164 = normalizePhone(r.from);
  if (!e164) return { matched: 0, kind, actedOn: 0 };

  const patients = await prisma.patient.findMany({ where: { phoneHash: phoneHash(e164) }, select: { id: true } });
  let acted = 0;
  for (const p of patients) {
    try {
      if (await handleForPatient(p.id, kind, r.providerMessageId)) acted++;
    } catch (err) {
      logger.error({ err, patientId: p.id }, 'Could not process an inbound reply'); // never let one patient's failure stop another's STOP
    }
  }
  return { matched: patients.length, kind, actedOn: acted };
}

async function handleForPatient(patientId: string, kind: InboundKind, providerMessageId: string): Promise<boolean> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const patient = await tx.patient.findUniqueOrThrow({ where: { id: patientId }, include: { consent: { orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }] } } });
    const orgId = patient.orgId;

    // The case this reply is about: the one most recently messaged, else the newest open one.
    const lastMessage = await tx.commsLog.findFirst({ where: { patientId, status: { in: ['SENT', 'DELIVERED', 'READ'] } }, orderBy: { requestedAt: 'desc' }, include: { case: true } });
    const openCases = await tx.referralCase.findMany({ where: { patientId, stage: { not: 'CLOSED' } }, orderBy: { createdAt: 'desc' } });
    const about = lastMessage?.case ?? openCases[0] ?? (await tx.referralCase.findFirst({ where: { patientId }, orderBy: { createdAt: 'desc' } }));

    // Idempotent: the provider may deliver the same webhook more than once.
    const recorded = await tx.inboundMessage.createMany({
      data: [{ orgId, patientId, caseId: about?.id ?? null, providerMessageId, channel: lastMessage?.channel ?? 'SMS', kind }],
      skipDuplicates: true,
    });
    if (recorded.count !== 1) return false;
    if (!about) return false;

    const audit = (action: string, detail: string) =>
      appendAudit(tx, { orgId, ...PATIENT_ACTOR, action, resourceType: 'ReferralCase', resourceId: about.refNumber, detail });
    const state = consentState(patient.consent);

    if (kind === 'OPT_OUT') {
      if (state.optedOut) return true; // already stopped: the reply changes nothing
      await recordOptOut(tx, { patientId, userId: null, at: nextConsentTime(patient.consent, now), basis: 'Patient replied STOP to an automated message' });
      // Anything still waiting to be sent is cancelled now, rather than left for the worker to refuse.
      await tx.commsLog.updateMany({ where: { patientId, status: 'QUEUED' }, data: { status: 'BLOCKED_OPTOUT', failureReason: 'The patient replied STOP.', nextAttemptAt: null } });
      await audit('CONSENT_OPTOUT_RECORDED', 'Patient opted out of automated messages by replying STOP. Routed to human coordinator.');
      for (const c of openCases.length ? openCases : [about]) {
        await routeToHuman(tx, c, 'The patient replied STOP and no longer wants automated messages.', { closing: ' Please contact them by phone only.' });
      }
      return true;
    }

    if (kind === 'RESTORE') {
      if (!state.optedOut) return true;
      const channels = restorableChannels(patient.consent);
      if (channels.length === 0) return true; // never consented: cannot be restored by a text alone
      await recordRestore(tx, { patientId, channels, userId: null, at: nextConsentTime(patient.consent, now), basis: 'Patient replied START to an automated message' });
      await audit('CONSENT_RESTORED', 'Patient asked to receive automated messages again by replying START.');
      return true;
    }

    if (kind === 'CONFIRM') {
      if (!lastMessage) return false; // a bare "1" with nothing to confirm
      await audit('PATIENT_CONFIRMED', 'Patient confirmed their follow-up appointment by replying to a message.');
      await tx.notification.createMany({ data: [{ orgId, userId: about.coordinatorId, kind: 'PATIENT_REPLY', caseRef: about.refNumber, title: `${about.refNumber}: patient confirmed`, body: 'The patient replied to confirm their follow-up.' }] });
      return true;
    }

    // Anything else is for a person to read and answer; its content is not kept.
    await audit('PATIENT_REPLIED', 'Patient replied to an automated message. A person should follow up.');
    await routeToHuman(tx as Prisma.TransactionClient, about, 'The patient replied to a message and needs a personal response.', {
      kind: 'PATIENT_REPLY', title: `${about.refNumber}: patient replied`, closing: ' Please follow up by phone.',
    });
    return true;
  });
}

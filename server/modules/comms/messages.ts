import { z } from 'zod';
import { CHANNEL_LABELS, PATHWAY_LABELS, ROLE_LABELS, type CommsLogDto, type CommsLogResponse, type DeliveryStatusId, type SendMessageResponse } from '../../../shared/types';
import { prisma } from '../../db/client';
import type { CommsLog, Prisma } from '../../db/generated/client';
import { forOrg, type TenantDb } from '../../db/tenant';
import { aad, decryptField, encryptField } from '../../lib/crypto';
import { HttpError } from '../../lib/errors';
import { normalizePhone, phoneHash } from '../../lib/phone';
import { clock } from '../../lib/clock';
import { getProvider } from '../../messaging/provider';
import type { AuthContext } from '../../types';
import { appendAudit } from '../audit/append';
import type { CaseRow } from '../cases/dto';
import { consentState } from '../cases/dto';
import { loadCase } from '../cases/service';
import { nextConsentTime } from '../consent/consent';
import { routeToHuman } from './humanRoute';
import { MAX_MESSAGES_PER_PATIENT_PER_DAY, inQuietHours, nextAllowedTime } from './schedule';
import { MAX_RENDERED_CHARS, lintTemplateBody, placeholdersIn, renderTemplate } from './template';

type Tx = Parameters<Parameters<TenantDb['$transaction']>[0]>[0];
const asPlain = (tx: unknown) => tx as Prisma.TransactionClient;

export const sendMessageSchema = z.object({ templateId: z.string().trim().min(1).max(64), channel: z.enum(['SMS', 'WHATSAPP']) });
export const contactSchema = z.object({ phone: z.string().trim().max(40).nullable() });
export const channelConsentSchema = z.object({ channel: z.enum(['SMS', 'WHATSAPP']), granted: z.boolean() });
export const commsLogQuerySchema = z.object({
  caseId: z.string().regex(/^REF-\d{4}-\d{4,}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(64).optional(),
});

/** Statuses that count toward a patient's daily limit: anything that was, or will be, sent. */
const COUNTED: DeliveryStatusId[] = ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ'];

type LogWith = CommsLog & { case: { refNumber: string }; patient: { patientCode: string } };

export function toCommsLogDto(l: LogWith): CommsLogDto {
  return {
    id: l.id, caseId: l.case.refNumber, patientCode: l.patient.patientCode, channel: l.channel as CommsLogDto['channel'], templateName: l.templateName,
    status: l.status, requestedAt: l.requestedAt.toISOString(), sentAt: l.sentAt?.toISOString() ?? null,
    scheduledFor: l.status === 'QUEUED' ? (l.nextAttemptAt?.toISOString() ?? null) : null,
    failureReason: l.failureReason, attempts: l.attempts,
  };
}

const logInclude = { case: { select: { refNumber: true } }, patient: { select: { patientCode: true } } } as const;

/** Is this patient currently reachable on this channel? Consent is per channel, and an opt-out overrides everything. */
export function consentBlock(state: ReturnType<typeof consentState>, channel: 'SMS' | 'WHATSAPP'): string | null {
  if (state.optedOut) return 'The patient has opted out of automated messages.';
  const granted = channel === 'SMS' ? state.consentSms : state.consentWhatsApp;
  return granted ? null : `No ${CHANNEL_LABELS[channel]} consent is recorded for this patient.`;
}

const actor = (a: AuthContext) => ({ orgId: a.orgId, actorId: a.userId, actorLabel: a.name, actorRole: ROLE_LABELS[a.role] });

// ───────────────────────────── sending ─────────────────────────────

/**
 * Asks to send a templated message to a patient. The message is NOT sent here: it is queued for the
 * worker, so that quiet hours, retries and a last consent check apply. Anything that stops it, a
 * missing consent above all, is recorded and handed to a person.
 */
export async function sendMessage(auth: AuthContext, ref: string, input: z.infer<typeof sendMessageSchema>): Promise<{ response: SendMessageResponse; kick: boolean }> {
  const now = clock();
  const out = await forOrg(auth.orgId).$transaction(async (tx) => {
    const c = await loadCase(tx, auth, ref);
    // One send decision per patient at a time, so two simultaneous requests cannot both slip under the daily limit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'comms:' + c.patientId}, 0))`;

    if (c.stage === 'CLOSED') throw new HttpError(409, 'CASE_CLOSED', 'This referral is closed, so no further messages can be sent');

    const template = await tx.messageTemplate.findFirst({ where: { id: input.templateId } });
    if (!template || template.retiredAt || !template.approvedAt) {
      throw new HttpError(422, 'TEMPLATE_NOT_APPROVED', 'Only approved templates can be sent');
    }
    if (template.channel !== input.channel) throw new HttpError(422, 'CHANNEL_MISMATCH', `This template is written for ${CHANNEL_LABELS[template.channel as 'SMS']}, not ${CHANNEL_LABELS[input.channel]}`);
    if (template.pathway && template.pathway !== c.pathway) {
      throw new HttpError(422, 'PATHWAY_MISMATCH', `This template is for ${PATHWAY_LABELS[template.pathway]} referrals only`);
    }
    // Wording is re-checked at the moment of sending, not just when it was saved.
    if (lintTemplateBody(template.body).length > 0) throw new HttpError(422, 'TEMPLATE_NOT_PERMITTED', 'This template no longer meets the discreet-wording rules. Ask for it to be corrected.');

    const base = { orgId: auth.orgId, caseId: c.id, patientId: c.patientId, channel: input.channel, templateId: template.id, templateName: template.name, requestedById: auth.userId, requestedAt: now };

    // 1 ── consent: the hard stop. Recorded, audited, and handed to a person.
    const blocked = consentBlock(consentState(c.patient.consent), input.channel);
    if (blocked) {
      const log = await tx.commsLog.create({ data: { ...base, status: 'BLOCKED_OPTOUT', failureReason: blocked }, include: logInclude });
      await appendAudit(asPlain(tx), { ...actor(auth), action: 'MESSAGE_BLOCKED_OPTOUT', resourceType: 'ReferralCase', resourceId: c.refNumber, detail: `Blocked ${CHANNEL_LABELS[input.channel]} "${template.name}": ${blocked}` });
      await routeToHuman(asPlain(tx), c, blocked);
      return { entry: toCommsLogDto(log as LogWith), accepted: false, message: `${blocked} Nothing was sent; the case owner has been asked to contact the patient directly.`, kick: false };
    }

    // 2 ── can we actually reach them? If not, a person must.
    const handToHuman = async (reason: string) => {
      const log = await tx.commsLog.create({ data: { ...base, status: 'HUMAN_ROUTED', failureReason: reason }, include: logInclude });
      await appendAudit(asPlain(tx), { ...actor(auth), action: 'MESSAGE_HUMAN_ROUTED', resourceType: 'ReferralCase', resourceId: c.refNumber, detail: `Did not send ${CHANNEL_LABELS[input.channel]} "${template.name}": ${reason}` });
      await routeToHuman(asPlain(tx), c, reason);
      return { entry: toCommsLogDto(log as LogWith), accepted: false, message: `${reason} The case owner has been asked to contact the patient directly.`, kick: false };
    };
    if (!getProvider().supports(input.channel)) return handToHuman(`${CHANNEL_LABELS[input.channel]} is not available yet.`);
    if (!c.patient.phoneEnc) return handToHuman('There is no mobile number on file for this patient.');

    // 3 ── wording: fill in the placeholders; refuse if something needed is missing.
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { supportPhone: true } });
    if (placeholdersIn(template.body).includes('phone') && !org.supportPhone) {
      throw new HttpError(422, 'SUPPORT_PHONE_REQUIRED', 'This template uses {phone}. Set your programme support phone number in Team & Settings first.');
    }
    const text = renderTemplate(template.body, { facility: c.facility.name, phone: org.supportPhone ?? '' });
    if (text.length > MAX_RENDERED_CHARS) throw new HttpError(422, 'MESSAGE_TOO_LONG', `The finished message is ${text.length} characters (limit ${MAX_RENDERED_CHARS}). Use a shorter template.`);

    // 4 ── do not over-message one person.
    const recent = await tx.commsLog.count({ where: { patientId: c.patientId, status: { in: COUNTED }, requestedAt: { gt: new Date(now.getTime() - 24 * 3_600_000) } } });
    if (recent >= MAX_MESSAGES_PER_PATIENT_PER_DAY) {
      throw new HttpError(429, 'MESSAGE_RATE_LIMITED', `This patient has already been sent ${MAX_MESSAGES_PER_PATIENT_PER_DAY} messages in the last 24 hours. Contact them directly instead.`);
    }

    // 5 ── queue it; quiet hours decide when it may go.
    const when = nextAllowedTime(now);
    const held = when.getTime() > now.getTime();
    const log = await tx.commsLog.create({ data: { ...base, body: text, status: 'QUEUED', nextAttemptAt: when }, include: logInclude });
    await appendAudit(asPlain(tx), {
      ...actor(auth), action: 'MESSAGE_QUEUED', resourceType: 'ReferralCase', resourceId: c.refNumber,
      detail: `Queued ${CHANNEL_LABELS[input.channel]} "${template.name}"${held ? ' (held until 07:00 for quiet hours)' : ''}.`,
    });
    return {
      entry: toCommsLogDto(log as LogWith), accepted: true, kick: !held,
      message: held ? 'Queued. It is outside sending hours (21:00-07:00), so it will go out at 07:00.' : 'Queued for delivery.',
    };
  });
  const { kick, ...response } = out;
  return { response, kick };
}

// ───────────────────────────── reading ─────────────────────────────

export async function listCommsLog(auth: AuthContext, q: z.infer<typeof commsLogQuerySchema>): Promise<CommsLogResponse> {
  const rows = await forOrg(auth.orgId).commsLog.findMany({
    where: q.caseId ? { case: { refNumber: q.caseId } } : undefined,
    include: logInclude, orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, q.limit);
  return { entries: page.map((r) => toCommsLogDto(r as LogWith)), nextCursor: rows.length > q.limit ? page[page.length - 1].id : null };
}

// ───────────────────────────── contact number and consent ─────────────────────────────

/** Adds, changes or removes the patient's mobile number. The number is stored encrypted and never returned or audited. */
export async function setContact(auth: AuthContext, ref: string, rawPhone: string | null): Promise<{ hasPhone: boolean }> {
  const e164 = rawPhone === null || rawPhone.trim() === '' ? null : normalizePhone(rawPhone);
  if (rawPhone && rawPhone.trim() !== '' && !e164) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ path: 'phone', message: 'Enter a valid mobile number, for example 0712 345 678 or +254 712 345 678' }]);
  }
  await forOrg(auth.orgId).$transaction(async (tx) => {
    const c = await loadCase(tx, auth, ref);
    const had = c.patient.phoneEnc !== null;
    await tx.patient.update({
      where: { id: c.patientId },
      data: e164
        ? { phoneEnc: encryptField(e164, aad.patientPhone(auth.orgId)), phoneHash: phoneHash(e164) }
        : { phoneEnc: null, phoneHash: null },
    });
    await appendAudit(asPlain(tx), {
      ...actor(auth), action: 'PATIENT_CONTACT_UPDATED', resourceType: 'ReferralCase', resourceId: c.refNumber,
      detail: e164 ? (had ? 'Patient mobile number changed.' : 'Patient mobile number added.') : 'Patient mobile number removed.',
    });
  });
  return { hasPhone: e164 !== null };
}

/** Records, or withdraws, a patient's consent for ONE channel (append-only). Granting is refused while they are opted out. */
export async function setChannelConsent(auth: AuthContext, ref: string, input: z.infer<typeof channelConsentSchema>): Promise<void> {
  const now = new Date();
  await forOrg(auth.orgId).$transaction(async (tx) => {
    const c = await loadCase(tx, auth, ref);
    const state = consentState(c.patient.consent);
    const current = input.channel === 'SMS' ? state.consentSms : state.consentWhatsApp;
    if (input.granted && state.optedOut) {
      throw new HttpError(409, 'OPTED_OUT', 'The patient has opted out. Restore their consent first, then record channel consent.');
    }
    if (current === input.granted) return; // already the case
    await tx.consent.create({
      data: {
        patientId: c.patientId, channel: input.channel, granted: input.granted, event: 'CAPTURED', recordedById: auth.userId,
        recordedAt: nextConsentTime(c.patient.consent, now),
        lawfulBasis: input.granted ? 'Consent recorded by the Data Protection Contact' : 'Consent withdrawn; recorded by the Data Protection Contact',
      },
    });
    await appendAudit(asPlain(tx), {
      ...actor(auth), action: 'CONSENT_UPDATED', resourceType: 'ReferralCase', resourceId: c.refNumber,
      detail: `${CHANNEL_LABELS[input.channel]} consent recorded as ${input.granted ? 'granted' : 'withdrawn'}.`,
    });
  });
}


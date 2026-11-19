import { z } from 'zod';
import { CHANNEL_LABELS, PATHWAY_LABELS, ROLE_LABELS } from '../../../shared/types';
import { prisma } from '../../db/client';
import { aad, decryptField } from '../../lib/crypto';
import { HttpError } from '../../lib/errors';
import { printableText } from '../../lib/validation';
import type { AuthContext } from '../../types';
import { appendAudit } from '../audit/append';
import { erasePatientData, type ErasureResult } from './erase';

export const erasureSchema = z.object({ reason: printableText(5, 300, 'Record why the data is being erased') });
export const PATIENT_CODE = /^[A-Za-z0-9-]{3,32}$/;

const actorOf = (auth: AuthContext) => ({ actorId: auth.userId, actorLabel: auth.name, actorRole: ROLE_LABELS[auth.role] });

async function findPatient(auth: AuthContext, patientCode: string) {
  const p = await prisma.patient.findFirst({ where: { orgId: auth.orgId, patientCode } });
  if (!p) throw HttpError.notFound('No patient with that code'); // also for another organisation's code
  return p;
}

/**
 * Subject access: everything held about one person, for answering their request. Reading it is itself recorded.
 * Replies from the patient are listed by kind and time only, because their text is never stored.
 */
export async function subjectAccessExport(auth: AuthContext, patientCode: string, now: Date = new Date()) {
  const p = await findPatient(auth, patientCode);
  const [cases, consent, messages, inbound] = await Promise.all([
    prisma.referralCase.findMany({ where: { patientId: p.id, orgId: auth.orgId }, include: { facility: { select: { name: true } }, milestones: true }, orderBy: { issuedAt: 'asc' } }),
    prisma.consent.findMany({ where: { patientId: p.id }, orderBy: { recordedAt: 'asc' } }),
    prisma.commsLog.findMany({ where: { patientId: p.id, orgId: auth.orgId }, orderBy: { requestedAt: 'asc' } }),
    prisma.inboundMessage.findMany({ where: { patientId: p.id, orgId: auth.orgId }, orderBy: { receivedAt: 'asc' } }),
  ]);

  await prisma.$transaction((tx) =>
    appendAudit(tx, {
      orgId: auth.orgId, ...actorOf(auth), action: 'PATIENT_DATA_ACCESSED', resourceType: 'Patient', resourceId: p.patientCode,
      detail: `Produced a subject access export for ${p.patientCode} (${cases.length} referral${cases.length === 1 ? '' : 's'}, ${messages.length} message${messages.length === 1 ? '' : 's'}).`,
    }),
  );

  return {
    generatedAt: now.toISOString(),
    patient: {
      patientCode: p.patientCode,
      name: decryptField(p.nameEnc, aad.patientName(p.orgId)),
      phone: p.phoneEnc ? decryptField(p.phoneEnc, aad.patientPhone(p.orgId)) : null,
      cohortLabel: p.label,
      registeredAt: p.createdAt.toISOString(),
      erasedAt: p.erasedAt?.toISOString() ?? null,
    },
    referrals: cases.map((c) => ({
      referralId: c.refNumber, pathway: PATHWAY_LABELS[c.pathway], sourceProgram: c.sourceProgram, facility: c.facility.name, stage: c.stage,
      redFlag: c.redFlag, issuedAt: c.issuedAt.toISOString(), closedAt: c.closedAt?.toISOString() ?? null, notes: c.notes,
      closureReason: c.closureReason, outcomeSource: c.outcomeSource,
      milestones: c.milestones.map((m) => ({ type: m.type, at: m.occurredAt.toISOString() })).sort((a, b) => a.at.localeCompare(b.at)),
    })),
    consent: consent.map((c) => ({ channel: c.channel, granted: c.granted, event: c.event, lawfulBasis: c.lawfulBasis, recordedAt: c.recordedAt.toISOString() })),
    messages: messages.map((m) => ({
      channel: CHANNEL_LABELS[m.channel as 'SMS'] ?? m.channel, template: m.templateName, status: m.status, text: m.body,
      requestedAt: m.requestedAt.toISOString(), sentAt: m.sentAt?.toISOString() ?? null,
    })),
    inboundReplies: inbound.map((i) => ({ channel: CHANNEL_LABELS[i.channel as 'SMS'] ?? i.channel, understoodAs: i.kind, receivedAt: i.receivedAt.toISOString() })),
  };
}

/**
 * Erasure on request. Refused while the person still has an open referral: erasing then would orphan a live clinical
 * follow-up, so the DPO must first have the referral closed (or decide the matter with the clinical lead). Repeating a
 * completed erasure is a no-op that says so.
 */
export async function erasePatient(auth: AuthContext, patientCode: string, reason: string, now: Date = new Date()): Promise<ErasureResult & { patientCode: string }> {
  const p = await findPatient(auth, patientCode);
  const result = await prisma.$transaction(async (tx) => {
    const open = await tx.referralCase.count({ where: { patientId: p.id, orgId: auth.orgId, stage: { not: 'CLOSED' } } });
    if (open > 0) {
      throw new HttpError(409, 'OPEN_REFERRALS', `${p.patientCode} still has ${open} open referral${open === 1 ? '' : 's'}. Close ${open === 1 ? 'it' : 'them'} before erasing personal data.`);
    }
    return erasePatientData(tx, p, actorOf(auth), `on request: ${reason}`, now);
  });
  return { patientCode: p.patientCode, ...result };
}

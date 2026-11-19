import type { Prisma } from '../../db/generated/client';
import { aad, encryptField } from '../../lib/crypto';
import { appendAudit } from '../audit/append';

export const ERASED_NAME = '[erased]';
export const REDACTED_TEXT = 'Redacted: personal data erased';

export interface Eraser {
  actorId: string | null;
  actorLabel: string;
  actorRole: string;
}

export interface ErasureResult {
  /** false when the person's data had already been erased (nothing changed). */
  erased: boolean;
  casesRedacted: number;
  messagesRedacted: number;
}

/**
 * Erases one person's personal data, inside the caller's transaction.
 *
 * What goes: the name (replaced by an encrypted placeholder so the row stays valid), the phone number and its lookup hash,
 * the name search tokens, the cohort label, the referral notes and closure narrative (free text that can identify someone),
 * and the text of every message sent to them.
 *
 * What stays, deliberately: the pseudonymous patient code, the referral rows (stage, pathway, facility, milestone times:
 * programme statistics and accountability), the consent history (a legal record that carries no contact details), and the
 * ENTIRE audit trail. The audit trail is append-only and hash-chained, and holds no patient names or numbers (only referral
 * numbers and patient codes), so erasure never has to alter it: the chain stays verifiable. Erasure adds its own audit event.
 *
 * Callers must make sure the person has no open referrals; this function does not decide that policy.
 */
export async function erasePatientData(
  tx: Prisma.TransactionClient,
  patient: { id: string; orgId: string; patientCode: string },
  by: Eraser,
  reason: string,
  now: Date,
): Promise<ErasureResult> {
  // The guard that makes this safe to call twice or concurrently: only the first caller flips erasedAt.
  const flipped = await tx.patient.updateMany({
    where: { id: patient.id, orgId: patient.orgId, erasedAt: null },
    data: {
      nameEnc: encryptField(ERASED_NAME, aad.patientName(patient.orgId)),
      phoneEnc: null, phoneHash: null, nameTokens: [], label: 'Erased', erasedAt: now,
    },
  });
  if (flipped.count === 0) return { erased: false, casesRedacted: 0, messagesRedacted: 0 };

  const cases = await tx.referralCase.updateMany({
    where: { patientId: patient.id, orgId: patient.orgId },
    data: { notes: REDACTED_TEXT, version: { increment: 1 } },
  });
  // A closed case must keep a documented outcome (a database rule), so its narrative is replaced, not removed.
  await tx.referralCase.updateMany({ where: { patientId: patient.id, orgId: patient.orgId, stage: 'CLOSED' }, data: { closureReason: REDACTED_TEXT } });
  const messages = await tx.commsLog.updateMany({ where: { patientId: patient.id, orgId: patient.orgId }, data: { body: null, failureReason: null } });

  await appendAudit(tx, {
    orgId: patient.orgId, ...by, action: 'PATIENT_DATA_ERASED', resourceType: 'Patient', resourceId: patient.patientCode,
    detail: `Erased personal data for ${patient.patientCode} (${reason}). ${cases.count} referral${cases.count === 1 ? '' : 's'} and ${messages.count} message${messages.count === 1 ? '' : 's'} redacted.`,
  });
  return { erased: true, casesRedacted: cases.count, messagesRedacted: messages.count };
}

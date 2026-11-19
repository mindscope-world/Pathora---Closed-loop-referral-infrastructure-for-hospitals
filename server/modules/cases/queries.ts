import { z } from 'zod';
import type { Prisma } from '../../db/generated/client';
import { nameTokens } from '../../lib/searchIndex';
import { caseScope } from '../../middleware/tenant';
import type { AuthContext } from '../../types';

export const listQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'AWAITING_ACK', 'OVERDUE_SLA', 'CLOSED_VERIFIED']).optional(),
  pathway: z.enum(['CANCER_SCREENING', 'NCD_SCREENING', 'MALE_REPRODUCTIVE_HEALTH', 'MATERNAL_CHILD_HEALTH']).optional(),
  facilityId: z.string().min(1).max(64).optional(),
  coordinatorId: z.string().min(1).max(64).optional(),
  redFlag: z.enum(['true', 'false']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

/** SQL form of `deriveStatus` (sla.ts). The two MUST stay in lock-step; cases.test.ts checks they agree. */
export function statusWhere(status: NonNullable<ListQuery['status']>, now: Date): Prisma.ReferralCaseWhereInput {
  const inFlight = { stage: { notIn: ['CLOSED', 'ESCALATED'] as ('CLOSED' | 'ESCALATED')[] }, slaDueAt: { gte: now } };
  switch (status) {
    case 'CLOSED_VERIFIED':
      return { stage: 'CLOSED' };
    case 'OVERDUE_SLA':
      return { stage: { not: 'CLOSED' }, OR: [{ stage: 'ESCALATED' }, { slaDueAt: { lt: now } }] };
    case 'AWAITING_ACK':
      return { ...inFlight, milestones: { none: { type: 'FACILITY_ACKNOWLEDGED' } } };
    case 'ACTIVE':
      return { ...inFlight, milestones: { some: { type: 'FACILITY_ACKNOWLEDGED' } } };
  }
}

/** Free-text search: ids, patient code, programme, facility, owner (substring) and patient name (whole word, via blind index). */
export function searchWhere(auth: AuthContext, q: string): Prisma.ReferralCaseWhereInput {
  const contains = { contains: q, mode: 'insensitive' as const };
  const tokens = nameTokens(auth.orgId, q);
  return {
    OR: [
      { refNumber: contains },
      { sourceProgram: contains },
      { patient: { patientCode: contains } },
      { facility: { name: contains } },
      { coordinator: { name: contains } },
      ...(tokens.length > 0 ? [{ patient: { nameTokens: { hasEvery: tokens } } }] : []),
    ],
  };
}

export function buildCaseWhere(auth: AuthContext, f: Partial<ListQuery>, now: Date): Prisma.ReferralCaseWhereInput {
  const and: Prisma.ReferralCaseWhereInput[] = [caseScope(auth), { isSynthetic: false }];
  if (f.status) and.push(statusWhere(f.status, now));
  if (f.pathway) and.push({ pathway: f.pathway });
  if (f.facilityId) and.push({ facilityId: f.facilityId });
  if (f.coordinatorId) and.push({ coordinatorId: f.coordinatorId });
  if (f.redFlag) and.push({ redFlag: f.redFlag === 'true' });
  if (f.q) and.push(searchWhere(auth, f.q));
  return { AND: and };
}

// Opaque cursor: the last row's internal id, base64url-wrapped so clients cannot depend on its shape.
export const encodeCursor = (id: string) => Buffer.from(`c1:${id}`).toString('base64url');
export function decodeCursor(cursor: string): string | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString();
    return raw.startsWith('c1:') && raw.length > 3 ? raw.slice(3) : null;
  } catch {
    return null;
  }
}

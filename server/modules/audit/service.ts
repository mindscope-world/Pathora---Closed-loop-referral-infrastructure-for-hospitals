import { z } from 'zod';
import type { AuditListResponse, AuditVerifyResponse } from '../../../shared/types';
import { prisma } from '../../db/client';
import type { Prisma } from '../../db/generated/client';
import { forOrg } from '../../db/tenant';
import { HttpError } from '../../lib/errors';
import type { AuthContext } from '../../types';
import { toAuditEventDto } from './dto';
import { verifyAuditChain } from './append';

const isoDate = z.string().trim().pipe(z.iso.datetime({ offset: true })).transform((v) => new Date(v));

export const auditQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  action: z.string().trim().min(1).max(64).optional(),
  resourceId: z.string().trim().min(1).max(64).optional(),
  actorId: z.string().trim().min(1).max(64).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(40).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

// Opaque keyset cursor over the monotonically increasing event id.
const encodeCursor = (id: bigint) => Buffer.from(`a1:${id}`).toString('base64url');
function decodeCursor(c: string): bigint | null {
  try {
    const m = /^a1:(\d{1,18})$/.exec(Buffer.from(c, 'base64url').toString());
    return m ? BigInt(m[1]) : null;
  } catch {
    return null;
  }
}

/** Newest first. Free text matches actor, action, resource id and detail (details never contain patient names). */
export async function listAudit(auth: AuthContext, q: AuditQuery): Promise<AuditListResponse> {
  const and: Prisma.AuditEventWhereInput[] = [];
  if (q.action) and.push({ action: q.action });
  if (q.resourceId) and.push({ resourceId: q.resourceId });
  if (q.actorId) and.push({ actorId: q.actorId });
  if (q.from) and.push({ at: { gte: q.from } });
  if (q.to) and.push({ at: { lte: q.to } });
  if (q.q) {
    const contains = { contains: q.q, mode: 'insensitive' as const };
    and.push({ OR: [{ actorLabel: contains }, { action: contains }, { resourceId: contains }, { detail: contains }] });
  }
  if (q.cursor) {
    const id = decodeCursor(q.cursor);
    if (id === null) throw HttpError.badRequest('Invalid cursor');
    and.push({ id: { lt: id } });
  }

  const rows = await forOrg(auth.orgId).auditEvent.findMany({
    where: and.length ? { AND: and } : undefined,
    orderBy: { id: 'desc' },
    take: q.limit + 1,
  });
  const page = rows.slice(0, q.limit);
  return {
    events: page.map(toAuditEventDto),
    nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1].id) : null,
  };
}

/**
 * Re-derives every hash in the organisation's chain. A clean result means no event has been edited,
 * removed or reordered since it was written. `tipHash` is the fingerprint of the whole history so
 * far: record it somewhere outside this database (a report, an email) and any later change to
 * earlier events becomes provable.
 */
export async function verifyChain(auth: AuthContext): Promise<AuditVerifyResponse> {
  const result = await verifyAuditChain(prisma, auth.orgId);
  const tip = await prisma.auditEvent.findFirst({ where: { orgId: auth.orgId }, orderBy: { id: 'desc' }, select: { hash: true } });
  const base = { tipHash: tip?.hash ?? null, verifiedAt: new Date().toISOString() };
  return result.ok
    ? { ok: true, count: result.count, ...base }
    : { ok: false, count: 0, brokenAtId: String(result.brokenAtId), reason: result.reason, ...base };
}

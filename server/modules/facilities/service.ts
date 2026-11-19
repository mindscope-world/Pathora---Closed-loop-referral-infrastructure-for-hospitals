import { z } from 'zod';
import { ROLE_LABELS, type FacilityDto } from '../../../shared/types';
import { prisma } from '../../db/client';
import type { Prisma } from '../../db/generated/client';
import { forOrg } from '../../db/tenant';
import { HttpError } from '../../lib/errors';
import { printableText } from '../../lib/validation';
import type { AuthContext } from '../../types';
import { appendAudit } from '../audit/append';

const FACILITY_TYPES = ['PUBLIC_REFERRAL', 'FAITH_BASED', 'PRIVATE_SPECIALIST', 'COUNTY_DIAGNOSTIC'] as const;
const INTEROP = ['PORTAL_CSV', 'API_READY', 'STATUS_RETURN_DESK'] as const;

const name = printableText(2, 160, 'Enter the facility name');
const city = printableText(1, 80, 'Enter the town or city');

export const createFacilitySchema = z.object({ name, type: z.enum(FACILITY_TYPES), city, interopMethod: z.enum(INTEROP) });
export const updateFacilitySchema = z
  .object({ name: name.optional(), type: z.enum(FACILITY_TYPES).optional(), city: city.optional(), interopMethod: z.enum(INTEROP).optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

const asTx = (tx: unknown) => tx as Prisma.TransactionClient;

/**
 * Facilities with their focal contact and measured acknowledgment time. A facility focal sees only
 * their own facility.
 */
export async function listFacilities(auth: AuthContext, onlyId?: string): Promise<FacilityDto[]> {
  const scopedId = auth.role === 'FACILITY_FOCAL' ? (auth.facilityId ?? '__none__') : onlyId;
  const facilities = await forOrg(auth.orgId).facility.findMany({
    where: scopedId ? { id: scopedId } : undefined,
    orderBy: { name: 'asc' },
    include: { users: { where: { role: 'FACILITY_FOCAL', active: true }, select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
  });

  // Mean hours from referral issued → facility acknowledged, per facility.
  const avgs = await prisma.$queryRaw<{ facilityId: string; avg: number }[]>`
    SELECT c."facilityId", AVG(EXTRACT(EPOCH FROM (a."occurredAt" - i."occurredAt")) / 3600.0)::float AS avg
    FROM "ReferralCase" c
    JOIN "CaseMilestone" i ON i."caseId" = c.id AND i.type = 'REFERRAL_ISSUED'
    JOIN "CaseMilestone" a ON a."caseId" = c.id AND a.type = 'FACILITY_ACKNOWLEDGED'
    WHERE c."orgId" = ${auth.orgId} AND NOT c."isSynthetic"
    GROUP BY c."facilityId"`;
  const avgByFacility = new Map(avgs.map((a) => [a.facilityId, Math.round(a.avg * 10) / 10]));

  return facilities.map((f) => ({
    id: f.id, name: f.name, type: f.type, city: f.city, interopMethod: f.interopMethod,
    focalPerson: f.users[0]?.name ?? null,
    avgAckHours: avgByFacility.get(f.id) ?? null,
  }));
}

const actor = (auth: AuthContext) => ({ orgId: auth.orgId, actorId: auth.userId, actorLabel: auth.name, actorRole: ROLE_LABELS[auth.role] });

const duplicate = () => new HttpError(409, 'FACILITY_EXISTS', 'A facility with this name already exists');

export async function createFacility(auth: AuthContext, input: z.infer<typeof createFacilitySchema>): Promise<FacilityDto> {
  let id: string;
  try {
    id = await forOrg(auth.orgId).$transaction(async (tx) => {
      const f = await tx.facility.create({ data: { orgId: auth.orgId, ...input } });
      await appendAudit(asTx(tx), {
        ...actor(auth), action: 'FACILITY_CREATED', resourceType: 'Facility', resourceId: f.id,
        detail: `Added receiving facility "${f.name}" (${f.city}).`,
      });
      return f.id;
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw duplicate();
    throw err;
  }
  return (await listFacilities(auth, id))[0];
}

export async function updateFacility(auth: AuthContext, id: string, patch: z.infer<typeof updateFacilitySchema>): Promise<FacilityDto> {
  try {
    await forOrg(auth.orgId).$transaction(async (tx) => {
      const before = await tx.facility.findFirst({ where: { id } });
      if (!before) throw HttpError.notFound('Facility not found');
      const changes = (Object.keys(patch) as (keyof typeof patch)[])
        .filter((k) => patch[k] !== undefined && patch[k] !== before[k])
        .map((k) => `${k}: "${before[k]}" → "${patch[k]}"`);
      if (changes.length === 0) return;
      await tx.facility.update({ where: { id }, data: patch });
      await appendAudit(asTx(tx), {
        ...actor(auth), action: 'FACILITY_UPDATED', resourceType: 'Facility', resourceId: id, detail: `Updated ${before.name}: ${changes.join('; ')}.`,
      });
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw duplicate();
    throw err;
  }
  return (await listFacilities(auth, id))[0];
}

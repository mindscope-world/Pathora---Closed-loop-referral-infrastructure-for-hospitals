import type { Prisma } from '../db/generated/client';
import type { Request } from 'express';
import { HttpError } from '../lib/errors';
import { forOrg, type TenantDb } from '../db/tenant';
import type { AuthContext } from '../types';

/** Tenant-scoped Prisma client for the authenticated caller. Use instead of the global `prisma`. */
export function tenantDb(req: Request): TenantDb {
  if (!req.auth) throw HttpError.unauthorized();
  return forOrg(req.auth.orgId);
}

/**
 * `where` fragment limiting referral cases to what the caller may see:
 * their organisation, and for facility focals only their own facility.
 * A focal with no facility assigned sees nothing rather than everything.
 */
export function caseScope(auth: AuthContext): Prisma.ReferralCaseWhereInput {
  if (auth.role === 'FACILITY_FOCAL') {
    return { orgId: auth.orgId, facilityId: auth.facilityId ?? '__none__' };
  }
  return { orgId: auth.orgId };
}

import { prisma } from './client';
import { HttpError } from '../lib/errors';

/**
 * Tenant isolation for Prisma. `forOrg(orgId)` returns a client that:
 *   - ANDs `orgId` into every filter on org-owned models (reads, updates, deletes, counts…),
 *   - stamps `orgId` on creates, and refuses a create/update that names a different org.
 * Route handlers use this client (`req.db`) so a missing `where: { orgId }` in new code cannot leak
 * another tenant's rows. Tables without their own orgId (CaseMilestone, Consent) are reached through
 * their already-scoped parent (case / patient) and must be queried that way.
 *
 * This is an application-layer guard; Postgres row-level security remains an option for Phase 11.
 */
const TENANT_MODELS = new Set([
  'User', 'Facility', 'Patient', 'RulePack', 'ReferralCase',
  'MessageTemplate', 'CommsLog', 'AuditEvent', 'ExportJob', 'Invite', 'Notification', 'ReportSchedule',
]);

/** Filters that accept arbitrary conditions: orgId is ANDed in. */
const FILTERED_OPS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany',
]);
/** Unique-selector operations: `where` must stay a unique filter, so orgId is added as an extra field. */
const UNIQUE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete']);

function assertSameOrg(data: any, orgId: string) {
  if (data && data.orgId !== undefined && data.orgId !== orgId) {
    throw new HttpError(403, 'CROSS_TENANT', 'Cross-organisation access is not permitted');
  }
}

export function forOrg(orgId: string) {
  if (!orgId) throw new Error('forOrg requires an orgId');
  return prisma.$extends({
    name: 'tenantScope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const a = args ?? {};

          if (FILTERED_OPS.has(operation)) {
            a.where = a.where ? { AND: [a.where, { orgId }] } : { orgId };
            if (operation === 'updateMany') assertSameOrg(a.data, orgId);
          } else if (UNIQUE_OPS.has(operation)) {
            // Spread order matters: our orgId wins over anything the caller put in `where`.
            a.where = { ...a.where, orgId };
            if (operation === 'update') assertSameOrg(a.data, orgId);
          } else if (operation === 'create') {
            assertSameOrg(a.data, orgId);
            a.data = { ...a.data, orgId };
          } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            rows.forEach((r: any) => assertSameOrg(r, orgId));
            a.data = rows.map((r: any) => ({ ...r, orgId }));
          } else if (operation === 'upsert') {
            a.where = { ...a.where, orgId };
            assertSameOrg(a.create, orgId);
            assertSameOrg(a.update, orgId);
            a.create = { ...a.create, orgId };
          } else {
            // Unknown operation on a tenant model: fail closed rather than run unscoped.
            throw new Error(`tenantScope: unsupported operation ${model}.${operation}`);
          }
          return query(a);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof forOrg>;

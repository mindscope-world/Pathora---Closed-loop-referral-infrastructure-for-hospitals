import { z } from 'zod';
import { ROLE_LABELS, type RulePackDto, type RulePackListResponse, type RulePackVersionDto } from '../../../shared/types';
import type { Prisma, RulePack } from '../../db/generated/client';
import { forOrg } from '../../db/tenant';
import { HttpError } from '../../lib/errors';
import type { AuthContext } from '../../types';
import { appendAudit } from '../audit/append';
import { describeChanges, parseRedFlagPolicy, timerProblem, type PackFields, updateRulePackSchema } from './rules';

const asTx = (tx: unknown) => tx as Prisma.TransactionClient;

const fieldsOf = (p: RulePack): PackFields => ({
  ackSlaHours: p.ackSlaHours, contactSlaHours: p.contactSlaHours, evalTargetDays: p.evalTargetDays, redFlagRule: p.redFlagRule,
  redFlagPolicy: parseRedFlagPolicy(p.redFlagPolicy), closureCriteria: p.closureCriteria, clinicalOwnerId: p.clinicalOwnerId, status: p.status,
});

function toDto(p: RulePack, names: Map<string, string>): RulePackDto {
  return {
    id: p.key, name: p.name, pathway: p.pathway, version: p.version, status: p.status,
    ackSlaHours: p.ackSlaHours, contactSlaHours: p.contactSlaHours, evalTargetDays: p.evalTargetDays,
    clinicalOwner: p.clinicalOwnerId ? { id: p.clinicalOwnerId, name: names.get(p.clinicalOwnerId) ?? 'Unknown user' } : null,
    redFlagRule: p.redFlagRule, redFlagPolicy: parseRedFlagPolicy(p.redFlagPolicy), closureCriteria: p.closureCriteria,
    effectiveFrom: p.effectiveFrom.toISOString(),
  };
}

async function nameMap(auth: AuthContext, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (unique.length === 0) return new Map();
  const users = await forOrg(auth.orgId).user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** The current version of every pack. */
export async function listRulePacks(auth: AuthContext): Promise<RulePackListResponse> {
  const db = forOrg(auth.orgId);
  const all = await db.rulePack.findMany({ orderBy: [{ key: 'asc' }, { version: 'desc' }] });
  const latest = all.filter((p, i) => i === 0 || all[i - 1].key !== p.key);
  const names = await nameMap(auth, latest.map((p) => p.clinicalOwnerId));
  const leads = await db.user.findMany({ where: { role: 'CLINICAL_LEAD', active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  // Stable, sensible order: the order the pathways are offered in.
  const order = ['CANCER_SCREENING', 'NCD_SCREENING', 'MALE_REPRODUCTIVE_HEALTH', 'MATERNAL_CHILD_HEALTH'];
  latest.sort((a, b) => order.indexOf(a.pathway) - order.indexOf(b.pathway));
  return { rulePacks: latest.map((p) => toDto(p, names)), clinicalLeads: leads };
}

/** Every version of one pack, newest first: the record of how its rules changed and who approved each change. */
export async function listVersions(auth: AuthContext, key: string): Promise<RulePackVersionDto[]> {
  const versions = await forOrg(auth.orgId).rulePack.findMany({ where: { key }, orderBy: { version: 'desc' } });
  if (versions.length === 0) throw HttpError.notFound('Rule pack not found');
  const names = await nameMap(auth, versions.flatMap((v) => [v.clinicalOwnerId, v.editedById]));
  return versions.map((v) => ({ ...toDto(v, names), editedBy: v.editedById ? (names.get(v.editedById) ?? 'Unknown user') : null }));
}

const invalid = (field: string, message: string) => new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ path: field, message }]);

/**
 * Changes a pack by publishing a NEW VERSION. Earlier versions are never edited, and every open referral
 * stays pinned to the version it was created under, so changing an SLA never retroactively changes
 * the clock on referrals already in flight. Only the version in force at creation time applies to a case.
 */
export async function updateRulePack(auth: AuthContext, key: string, input: z.infer<typeof updateRulePackSchema>): Promise<RulePackDto> {
  const { expectedVersion, ...patch } = input;
  try {
    return await forOrg(auth.orgId).$transaction(async (tx) => {
      const latest = await tx.rulePack.findFirst({ where: { key }, orderBy: { version: 'desc' } });
      if (!latest) throw HttpError.notFound('Rule pack not found');
      if (expectedVersion !== undefined && expectedVersion !== latest.version) {
        throw new HttpError(409, 'VERSION_CONFLICT', `This rule pack was changed by someone else (now version ${latest.version}). Reload and try again.`);
      }

      const before = fieldsOf(latest);
      const after: PackFields = { ...before };
      for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
        if (patch[k] !== undefined) (after as unknown as Record<string, unknown>)[k] = patch[k];
      }

      const problem = timerProblem(after);
      if (problem) throw invalid(problem.field, problem.message);

      if (patch.clinicalOwnerId && patch.clinicalOwnerId !== before.clinicalOwnerId) {
        const owner = await tx.user.findFirst({ where: { id: patch.clinicalOwnerId, active: true, role: 'CLINICAL_LEAD' }, select: { id: true } });
        if (!owner) throw new HttpError(422, 'INVALID_REFERENCE', 'The clinical owner must be an active Partner Clinical Lead');
      }
      // Going live needs a named person accountable for the rules.
      if (after.status === 'ACTIVE' && before.status !== 'ACTIVE' && !after.clinicalOwnerId) {
        throw new HttpError(422, 'OWNER_REQUIRED', 'Name a clinical owner before activating this pathway');
      }

      const names = await nameMap(auth, [before.clinicalOwnerId, after.clinicalOwnerId]);
      const changes = describeChanges(before, after, names);
      if (changes.length === 0) return toDto(latest, names); // nothing changed: no new version, no audit entry

      const created = await tx.rulePack.create({
        data: {
          orgId: auth.orgId, key, pathway: latest.pathway, name: latest.name, version: latest.version + 1, effectiveFrom: new Date(), editedById: auth.userId,
          status: after.status, ackSlaHours: after.ackSlaHours, contactSlaHours: after.contactSlaHours, evalTargetDays: after.evalTargetDays,
          clinicalOwnerId: after.clinicalOwnerId, redFlagRule: after.redFlagRule, closureCriteria: after.closureCriteria,
          redFlagPolicy: after.redFlagPolicy as unknown as Prisma.InputJsonValue,
        },
      });
      await appendAudit(asTx(tx), {
        orgId: auth.orgId, actorId: auth.userId, actorLabel: auth.name, actorRole: ROLE_LABELS[auth.role],
        action: 'RULE_PACK_UPDATED', resourceType: 'RulePack', resourceId: key,
        detail: `${latest.name}: published v${created.version} (was v${latest.version}). ${changes.join('; ')}. Referrals already open keep their original rules.`,
      });
      return toDto(created, names);
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      throw new HttpError(409, 'VERSION_CONFLICT', 'This rule pack was changed by someone else at the same moment. Reload and try again.');
    }
    throw err;
  }
}

import { z } from 'zod';
import { ROLE_LABELS, type OrganizationDto } from '../../../shared/types';
import { prisma } from '../../db/client';
import type { Organization, Prisma } from '../../db/generated/client';
import { printableText } from '../../lib/validation';
import type { AuthContext } from '../../types';
import { appendAudit } from '../audit/append';

export const RETENTION_MIN_DAYS = 30;
export const RETENTION_MAX_DAYS = 3650;

export const updateOrganizationSchema = z
  .object({
    name: printableText(2, 160, 'Enter the organisation name').optional(),
    // Empty text clears the contact.
    dpoContact: printableText(0, 200, '').transform((v) => (v === '' ? null : v)).nullable().optional(),
    // Substituted into patient messages as {phone}, so keep it short and single-line.
    supportPhone: printableText(0, 30, '').transform((v) => (v === '' ? null : v)).nullable().optional(),
    retentionDays: z.number().int('Use a whole number of days').min(RETENTION_MIN_DAYS, `Retention must be at least ${RETENTION_MIN_DAYS} days`)
      .max(RETENTION_MAX_DAYS, `Retention must be at most ${RETENTION_MAX_DAYS} days`).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const toOrganizationDto = (o: Organization): OrganizationDto => ({
  id: o.id, name: o.name, dpoContact: o.dpoContact, supportPhone: o.supportPhone, retentionDays: o.retentionDays, createdAt: o.createdAt.toISOString(),
});

export async function getOrganization(auth: AuthContext): Promise<OrganizationDto> {
  return toOrganizationDto(await prisma.organization.findUniqueOrThrow({ where: { id: auth.orgId } }));
}

const LABELS = { name: 'Organisation name', dpoContact: 'Data protection contact', supportPhone: 'Support phone', retentionDays: 'Retention window (days)' } as const;

export async function updateOrganization(auth: AuthContext, patch: z.infer<typeof updateOrganizationSchema>): Promise<OrganizationDto> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({ where: { id: auth.orgId } });
    const changes = (Object.keys(patch) as (keyof typeof LABELS)[])
      .filter((k) => patch[k] !== undefined && patch[k] !== before[k])
      .map((k) => `${LABELS[k]}: ${JSON.stringify(before[k])} → ${JSON.stringify(patch[k])}`);
    if (changes.length === 0) return toOrganizationDto(before);

    const after = await tx.organization.update({ where: { id: auth.orgId }, data: patch });
    await appendAudit(tx as Prisma.TransactionClient, {
      orgId: auth.orgId, actorId: auth.userId, actorLabel: auth.name, actorRole: ROLE_LABELS[auth.role],
      action: 'ORG_SETTINGS_UPDATED', resourceType: 'Organization', resourceId: auth.orgId, detail: `${changes.join('; ')}.`,
    });
    return toOrganizationDto(after);
  });
}


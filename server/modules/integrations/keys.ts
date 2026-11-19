import { z } from 'zod';
import { ROLE_LABELS, type CreatedApiKeyResponse, type FacilityApiKeyDto } from '../../../shared/types';
import type { FacilityApiKey, Prisma } from '../../db/generated/client';
import { forOrg } from '../../db/tenant';
import { aad, encryptField } from '../../lib/crypto';
import { HttpError } from '../../lib/errors';
import { printableText } from '../../lib/validation';
import { API_KEY_SCOPES, generateApiKey } from '../../integrations/apiKeys';
import type { AuthContext } from '../../types';
import { appendAudit } from '../audit/append';

export const MAX_ACTIVE_KEYS_PER_FACILITY = 5;

export const createKeySchema = z.object({
  name: printableText(2, 80, 'Give the key a name'),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1, 'Choose at least one permission').max(API_KEY_SCOPES.length).transform((s) => [...new Set(s)]),
  expiresInDays: z.number().int().min(1).max(730).optional(),
});

type KeyRow = FacilityApiKey & { createdBy: { name: string } };

export const toKeyDto = (k: KeyRow): FacilityApiKeyDto => ({
  id: k.id, name: k.name, keyPrefix: `pk_${k.keyId}`, scopes: k.scopes as FacilityApiKeyDto['scopes'], createdBy: k.createdBy.name,
  createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  expiresAt: k.expiresAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null,
});

const audit = (tx: unknown, auth: AuthContext, action: string, facilityId: string, detail: string) =>
  appendAudit(tx as Prisma.TransactionClient, {
    orgId: auth.orgId, actorId: auth.userId, actorLabel: auth.name, actorRole: ROLE_LABELS[auth.role],
    action, resourceType: 'Facility', resourceId: facilityId, detail,
  });

async function facilityOf(auth: AuthContext, facilityId: string) {
  const f = await forOrg(auth.orgId).facility.findFirst({ where: { id: facilityId }, select: { id: true, name: true } });
  if (!f) throw HttpError.notFound('Facility not found');
  return f;
}

export async function listKeys(auth: AuthContext, facilityId: string): Promise<FacilityApiKeyDto[]> {
  await facilityOf(auth, facilityId);
  const rows = await forOrg(auth.orgId).facilityApiKey.findMany({ where: { facilityId }, include: { createdBy: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
  return rows.map(toKeyDto);
}

export async function createKey(auth: AuthContext, facilityId: string, input: z.infer<typeof createKeySchema>): Promise<CreatedApiKeyResponse> {
  const facility = await facilityOf(auth, facilityId);
  const gen = generateApiKey();
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;

  const row = await forOrg(auth.orgId).$transaction(async (tx) => {
    const active = await tx.facilityApiKey.count({ where: { facilityId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (active >= MAX_ACTIVE_KEYS_PER_FACILITY) {
      throw new HttpError(409, 'TOO_MANY_KEYS', `A facility can have up to ${MAX_ACTIVE_KEYS_PER_FACILITY} active keys. Revoke one first.`);
    }
    const created = await tx.facilityApiKey.create({
      data: {
        orgId: auth.orgId, facilityId, name: input.name, keyId: gen.keyId, secretHash: gen.secretHash,
        signingSecretEnc: encryptField(gen.signingSecret, aad.apiKeySigning(auth.orgId, gen.keyId)),
        scopes: input.scopes, createdById: auth.userId, expiresAt,
      },
      include: { createdBy: { select: { name: true } } },
    });
    // The audit entry names the key and its permissions, never any secret.
    await audit(tx, auth, 'API_KEY_CREATED', facilityId, `Created API key "${input.name}" for ${facility.name} (${input.scopes.join(', ')}${expiresAt ? `; expires ${expiresAt.toISOString().slice(0, 10)}` : ''}).`);
    return created;
  });
  return { ...toKeyDto(row), apiKey: gen.apiKey, signingSecret: gen.signingSecret };
}

export async function revokeKey(auth: AuthContext, facilityId: string, id: string): Promise<void> {
  const facility = await facilityOf(auth, facilityId);
  await forOrg(auth.orgId).$transaction(async (tx) => {
    const key = await tx.facilityApiKey.findFirst({ where: { id, facilityId } });
    if (!key) throw HttpError.notFound('API key not found');
    if (key.revokedAt) return; // already revoked: nothing to do
    await tx.facilityApiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit(tx, auth, 'API_KEY_REVOKED', facilityId, `Revoked API key "${key.name}" for ${facility.name}.`);
  });
}


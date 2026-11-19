import { createHash } from 'node:crypto';

/** prevHash of the first event in an organisation's chain. */
export const GENESIS_HASH = '0'.repeat(64);

export interface AuditHashInput {
  orgId: string;
  at: Date;
  actorId: string | null;
  actorLabel: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  detail: string;
}

/** Deterministic JSON: keys sorted, no whitespace. Only plain data is expected. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

export function computeAuditHash(prevHash: string, e: AuditHashInput): string {
  // Hash exactly these fields and nothing else, so the writer (new event) and the verifier (a full
  // DB row carrying id/prevHash/hash too) always hash identical data.
  const payload = canonicalJson({
    orgId: e.orgId,
    at: e.at.toISOString(),
    actorId: e.actorId,
    actorLabel: e.actorLabel,
    actorRole: e.actorRole,
    action: e.action,
    resourceType: e.resourceType,
    resourceId: e.resourceId,
    detail: e.detail,
  });
  return createHash('sha256').update(prevHash).update('\n').update(payload).digest('hex');
}

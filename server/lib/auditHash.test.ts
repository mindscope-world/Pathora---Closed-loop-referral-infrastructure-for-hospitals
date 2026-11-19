import { describe, expect, it } from 'vitest';
import { canonicalJson, computeAuditHash, GENESIS_HASH, type AuditHashInput } from './auditHash';

const base: AuditHashInput = {
  orgId: 'o1', at: new Date('2026-11-19T10:00:00.000Z'), actorId: null, actorLabel: 'A', actorRole: 'R',
  action: 'X', resourceType: 'ReferralCase', resourceId: 'REF-1', detail: 'd',
};

describe('canonicalJson', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe('computeAuditHash', () => {
  it('is deterministic 64-char hex', () => {
    const h = computeAuditHash(GENESIS_HASH, base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeAuditHash(GENESIS_HASH, { ...base })).toBe(h);
  });

  it('ignores fields outside the hashed set (a DB row hashes the same as its source event)', () => {
    const row = { ...base, id: 5n, prevHash: GENESIS_HASH, hash: 'x'.repeat(64) };
    expect(computeAuditHash(GENESIS_HASH, row)).toBe(computeAuditHash(GENESIS_HASH, base));
  });

  it('changes when any field or the previous hash changes', () => {
    const h = computeAuditHash(GENESIS_HASH, base);
    expect(computeAuditHash(GENESIS_HASH, { ...base, detail: 'tampered' })).not.toBe(h);
    expect(computeAuditHash(GENESIS_HASH, { ...base, at: new Date('2026-11-19T10:00:00.001Z') })).not.toBe(h);
    expect(computeAuditHash('1'.repeat(64), base)).not.toBe(h);
  });
});

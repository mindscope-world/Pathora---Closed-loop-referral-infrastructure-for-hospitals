import { describe, expect, it } from 'vitest';
import { nameTokens, nameWords } from './searchIndex';

describe('nameWords', () => {
  it('lowercases, strips accents and punctuation, drops 1-char fragments', () => {
    expect(nameWords("Wanjiku, M. O'Brien-Élodie")).toEqual(['wanjiku', 'brien', 'elodie']);
    expect(nameWords('  JANE   Wambui ')).toEqual(['jane', 'wambui']);
  });
});

describe('nameTokens', () => {
  it('is deterministic, order-insensitive for matching, and contains no plaintext', () => {
    const a = nameTokens('org1', 'Jane Wambui');
    expect(a).toEqual(nameTokens('org1', 'Jane Wambui'));
    expect([...nameTokens('org1', 'wambui jane')].sort()).toEqual([...a].sort());
    expect(a.every((t) => /^[0-9a-f]{64}$/.test(t))).toBe(true);
    expect(JSON.stringify(a).toLowerCase()).not.toMatch(/jane|wambui/);
  });
  it('hashes the same word differently in different organisations', () => {
    expect(nameTokens('org1', 'Jane')[0]).not.toBe(nameTokens('org2', 'Jane')[0]);
  });
  it('de-duplicates words and caps the token count', () => {
    expect(nameTokens('o', 'Jane Jane Jane')).toHaveLength(1);
    expect(nameTokens('o', 'a1 b2 c3 d4 e5 f6 g7 h8 i9 j0')).toHaveLength(8);
  });
});

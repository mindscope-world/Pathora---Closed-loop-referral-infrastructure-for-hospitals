import { createHmac } from 'node:crypto';

/**
 * Blind index for patient names.
 *
 * Names are stored encrypted, so they cannot be searched directly. Instead each lowercased word is
 * stored as a keyed HMAC (`Patient.nameTokens`); searching hashes the query words and matches them.
 *
 * Trade-offs, chosen deliberately:
 *  - Matches WHOLE words only ("wambui", "jane wambui"), not prefixes ("wam").
 *  - The key is derived from FIELD_ENCRYPTION_KEY with a distinct label, so it is never the
 *    encryption key itself. Without the key the tokens cannot be reversed or guessed offline.
 *  - Equal words hash equally, so someone with database access could see which patients share a
 *    word (frequency leakage). That is inherent to any searchable encryption.
 */
const MAX_TOKENS = 8;

function indexKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) throw new Error('FIELD_ENCRYPTION_KEY is not set');
  return createHmac('sha256', Buffer.from(raw, 'base64')).update('pathora:name-search-index:v1').digest();
}

/** Lowercase, strip diacritics/punctuation, split on whitespace. */
export function nameWords(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

export function nameTokens(orgId: string, text: string): string[] {
  const key = indexKey();
  const unique = [...new Set(nameWords(text))].slice(0, MAX_TOKENS);
  // Scoped per organisation so the same word hashes differently in different tenants.
  return unique.map((w) => createHmac('sha256', key).update(`${orgId}\0${w}`).digest('hex'));
}

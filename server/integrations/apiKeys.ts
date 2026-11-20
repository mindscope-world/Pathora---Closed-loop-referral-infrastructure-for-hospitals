import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const API_KEY_SCOPES = ['referrals:read', 'referrals:identify', 'status:write'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** `pk_<keyId>.<secret>`: the key id finds the row; only a hash of the secret is stored. */
const KEY_RE = /^pk_([A-Za-z0-9]{12})\.([A-Za-z0-9_-]{43})$/;

export interface GeneratedKey {
  keyId: string;
  /** The full credential, shown to the person once. */
  apiKey: string;
  secretHash: string;
  /** HMAC signing secret, shown once; stored encrypted. */
  signingSecret: string;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const randomId = (n: number) => Array.from(randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join('');

export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

export function generateApiKey(): GeneratedKey {
  const keyId = randomId(12);
  const secret = randomBytes(32).toString('base64url'); // 43 chars
  return { keyId, apiKey: `pk_${keyId}.${secret}`, secretHash: hashSecret(secret), signingSecret: `whsec_${randomBytes(32).toString('base64url')}` };
}

export function parseApiKey(raw: string): { keyId: string; secret: string } | null {
  const m = KEY_RE.exec(raw);
  return m ? { keyId: m[1], secret: m[2] } : null;
}

/** Constant-time comparison of a presented secret with the stored hash. */
export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ───────────────────────────── request signing ─────────────────────────────

/** How far a signed request's timestamp may be from ours. Bounds replay of a captured request. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** `X-Pathora-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. */
export function signBody(signingSecret: string, body: Buffer | string, at: Date = new Date()): string {
  const t = Math.floor(at.getTime() / 1000);
  const mac = createHmac('sha256', signingSecret).update(`${t}.`).update(body).digest('hex');
  return `t=${t},v1=${mac}`;
}

export type SignatureResult = 'ok' | 'missing' | 'malformed' | 'stale' | 'mismatch';

export function verifySignature(signingSecret: string, body: Buffer, header: string | undefined, now: Date = new Date()): SignatureResult {
  if (!header) return 'missing';
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!m) return 'malformed';
  const t = Number(m[1]);
  if (Math.abs(now.getTime() / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS) return 'stale';
  const expected = createHmac('sha256', signingSecret).update(`${t}.`).update(body).digest();
  const given = Buffer.from(m[2], 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected) ? 'ok' : 'mismatch';
}

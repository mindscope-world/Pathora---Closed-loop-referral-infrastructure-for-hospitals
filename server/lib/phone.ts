import { createHmac } from 'node:crypto';

/**
 * Phone numbers. Everything is normalised to E.164 (+254712345678) before it is stored, hashed or sent to
 * a provider, so the same person is always the same string however the number was typed.
 *
 * Accepts the ways numbers are actually written in Kenya: 0712 345 678, 0112345678, 254712345678,
 * +254 712 345 678, 712345678, 00254712345678. Local Kenyan forms must be MOBILE numbers (07… / 01…),
 * because a landline cannot receive an SMS. Other countries are accepted only with an explicit +country code.
 */
export function normalizePhone(raw: string): string | null {
  let s = raw.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;

  if (s.startsWith('+')) {
    const digits = s.slice(1);
    if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
    // A Kenyan number must be a mobile one (7… or 1…); anything else under +254 is a landline or malformed.
    if (digits.startsWith('254') && !/^254[17]\d{8}$/.test(digits)) return null;
    return `+${digits}`;
  }
  if (!/^\d+$/.test(s)) return null;
  if (/^254[17]\d{8}$/.test(s)) return `+${s}`;
  if (/^0[17]\d{8}$/.test(s)) return `+254${s.slice(1)}`;
  if (/^[17]\d{8}$/.test(s)) return `+254${s}`;
  return null;
}

function indexKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) throw new Error('FIELD_ENCRYPTION_KEY is not set');
  return createHmac('sha256', Buffer.from(raw, 'base64')).update('pathora:phone-index:v1').digest();
}

/**
 * Keyed hash of a normalised number, for matching an inbound reply to a patient without keeping the number
 * in the clear. It is deliberately NOT scoped to an organisation: a STOP texted by one person must reach
 * every programme that has been messaging that number. The cost is that two organisations holding the same
 * number produce the same hash, which is the point.
 */
export function phoneHash(e164: string): string {
  return createHmac('sha256', indexKey()).update(e164).digest('hex');
}

/** "+254712345678" → "+254•••••678", for showing that a number exists without showing the number. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)}${'•'.repeat(Math.max(0, e164.length - 7))}${e164.slice(-3)}`;
}

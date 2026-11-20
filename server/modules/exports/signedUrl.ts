import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';

/**
 * Short-lived, tamper-proof download links.
 *
 * The link itself is the credential (so a plain <a href> can download without our in-memory access
 * token), which is why it is bound to one export and one organisation, expires in minutes, and is
 * re-checked against the requester's current permissions when used. A fresh link is minted every
 * time an export is fetched through the authenticated API.
 */
export const DOWNLOAD_LINK_TTL_SECONDS = 5 * 60;

// Key derived from the JWT secret with a distinct label: a download token can never be used as a login token.
const key = () => createHmac('sha256', env.JWT_SECRET).update('pathora:export-download:v1').digest();

const sign = (body: string) => createHmac('sha256', key()).update(body).digest('base64url');

export function signDownloadToken(jobId: string, orgId: string, nowMs: number = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ j: jobId, o: orgId, e: Math.floor(nowMs / 1000) + DOWNLOAD_LINK_TTL_SECONDS })).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** Returns the organisation the link was minted for, or null if it is forged, expired or for another export. */
export function verifyDownloadToken(token: string, jobId: string, nowMs: number = Date.now()): { orgId: string } | null {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as { j?: unknown; o?: unknown; e?: unknown };
    if (p.j !== jobId || typeof p.o !== 'string' || typeof p.e !== 'number') return null;
    if (p.e * 1000 < nowMs) return null;
    return { orgId: p.o };
  } catch {
    return null;
  }
}

/** Replaces secrets carried in a URL (download tokens, webhook secrets) so they never reach the logs. */
export const redactToken = (url: string) => url.replace(/([?&](?:token|secret)=)[^&#]*/g, '$1[redacted]');

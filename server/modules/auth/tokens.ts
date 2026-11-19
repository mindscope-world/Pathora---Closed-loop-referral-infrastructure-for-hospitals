import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { HttpError } from '../../lib/errors';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 7;
/** Rotating refresh tokens may not extend a login past this many days since the original sign-in. */
export const REFRESH_FAMILY_MAX_DAYS = 30;

const ISSUER = 'pathora';
const AUDIENCE = 'pathora-api';

export interface AccessClaims {
  sub: string; // user id
  org: string; // org id (cross-checked against the DB row on every request)
}

export function signAccessToken(userId: string, orgId: string): string {
  return jwt.sign({ org: orgId }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    // Pin the algorithm: never let the token choose it (blocks `alg: none` and key-confusion).
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.org !== 'string') {
      throw new Error('bad claims');
    }
    return { sub: payload.sub, org: payload.org };
  } catch {
    throw HttpError.unauthorized('Invalid or expired access token');
  }
}

/** Opaque refresh token: 256 random bits. Only its SHA-256 is stored. */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

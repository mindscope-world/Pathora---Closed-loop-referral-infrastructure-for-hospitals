import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../../db/client';
import { aad, decryptField } from '../../lib/crypto';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { hashSecret, parseApiKey, secretMatches, verifySignature, type ApiKeyScope } from '../../integrations/apiKeys';
import type { AuthContext } from '../../types';

export interface IntegrationContext {
  keyRowId: string;
  keyId: string;
  keyName: string;
  scopes: string[];
  orgId: string;
  facilityId: string;
  facilityName: string;
  organisationName: string;
  signingSecretEnc: Uint8Array;
}

declare module 'express-serve-static-core' {
  interface Request {
    integration?: IntegrationContext;
  }
}

// Same message for every failure: nobody can tell "no such key" from "wrong secret" from "revoked".
const INVALID = () => new HttpError(401, 'INVALID_API_KEY', 'Invalid or expired API key');
const DUMMY_HASH = hashSecret('no-such-key'); // so an unknown key id costs the same as a known one
const TOUCH_EVERY_MS = 60_000;

/** The identity case actions run as: this facility, nobody else, flagged as a system rather than a person. */
export const integrationAuth = (ctx: IntegrationContext): AuthContext => ({
  userId: '', orgId: ctx.orgId, role: 'FACILITY_FOCAL', facilityId: ctx.facilityId, name: `API key "${ctx.keyName}"`, email: '', via: 'integration',
});

/** Throttles only FAILED attempts per IP (guessing), so a legitimate integration is never penalised by it. */
export const failedKeyLimiter = (max: number): RequestHandler =>
  rateLimit({
    windowMs: 60_000, limit: max, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.')),
  });

/** A generous per-key cap, applied after authentication so it counts each integration separately. */
export const perKeyLimiter = (max: number): RequestHandler =>
  rateLimit({
    windowMs: 60_000, limit: max, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => req.integration?.keyId ?? 'anonymous',
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, _res, next) => next(new HttpError(429, 'RATE_LIMITED', 'Too many requests for this API key. Please slow down.')),
  });

/** Requires a valid, unrevoked, unexpired facility key carrying `scope`. Sets `req.integration` and `req.auth`. */
export const authenticateKey = (scope: ApiKeyScope): RequestHandler =>
  asyncHandler(async (req, _res, next) => {
    const m = /^Bearer (\S+)$/.exec(req.header('authorization') ?? '');
    const parsed = m ? parseApiKey(m[1]) : null;
    if (!parsed) throw INVALID();

    const key = await prisma.facilityApiKey.findUnique({
      where: { keyId: parsed.keyId },
      include: { facility: { select: { name: true } }, org: { select: { name: true } } },
    });
    const ok = secretMatches(parsed.secret, key?.secretHash ?? DUMMY_HASH);
    if (!key || !ok || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date())) throw INVALID();
    // Authenticated, but not allowed: say so (the integrator holds a real key and needs to know why).
    if (!key.scopes.includes(scope)) throw new HttpError(403, 'INSUFFICIENT_SCOPE', `This API key does not have the "${scope}" permission`);

    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      void prisma.facilityApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch((err) => logger.warn({ err }, 'Could not record API key use'));
    }
    const ctx: IntegrationContext = {
      keyRowId: key.id, keyId: key.keyId, keyName: key.name, scopes: key.scopes, orgId: key.orgId, facilityId: key.facilityId,
      facilityName: key.facility.name, organisationName: key.org.name, signingSecretEnc: key.signingSecretEnc,
    };
    req.integration = ctx;
    req.auth = integrationAuth(ctx);
    next();
  });

/** The exact bytes the client sent (the raw-body parser is mounted ahead of the JSON parser). */
export const rawBody = (req: { body?: unknown }): Buffer => (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));

/** For POSTs: the body must carry a valid HMAC signature made with this key's signing secret, and be fresh. */
export const requireSignature: RequestHandler = (req, _res, next) => {
  const ctx = req.integration;
  if (!ctx) return next(INVALID());
  let secret: string;
  try {
    secret = decryptField(ctx.signingSecretEnc, aad.apiKeySigning(ctx.orgId, ctx.keyId));
  } catch (err) {
    logger.error({ err, keyId: ctx.keyId }, 'Could not read an API key signing secret');
    return next(new HttpError(500, 'INTERNAL', 'Could not verify the request signature'));
  }
  const result = verifySignature(secret, rawBody(req), req.header('x-pathora-signature'));
  if (result !== 'ok') {
    const why = { missing: 'is missing', malformed: 'is malformed', stale: 'is too old or too far in the future (check your clock)', mismatch: 'does not match the request body' }[result];
    return next(new HttpError(401, 'INVALID_SIGNATURE', `The X-Pathora-Signature header ${why}`));
  }
  next();
};

/** Parses the (already verified) raw body as a JSON object. */
export function jsonBody(req: { body?: unknown }): Record<string, unknown> {
  const raw = rawBody(req);
  if (raw.length === 0) return {};
  try {
    const v = JSON.parse(raw.toString('utf8'));
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw HttpError.badRequest('The request body must be a JSON object');
  }
}

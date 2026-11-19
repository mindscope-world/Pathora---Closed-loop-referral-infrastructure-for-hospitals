import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { prisma } from '../db/client';
import { canonicalJson } from '../lib/auditHash';
import { HttpError } from '../lib/errors';
import { asyncHandler } from '../lib/asyncHandler';

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const TTL_MS = 24 * 3_600_000;

/**
 * Makes a POST safe to retry. If the client sends `Idempotency-Key`, a repeat of the same request
 * returns the ORIGINAL response (header `Idempotent-Replayed: true`) instead of creating a second
 * record — the failure mode being prevented is a double-tapped button or a retry after a dropped
 * response creating duplicate referrals.
 *
 *  - same key + same body        → replay the stored response
 *  - same key + different body   → 422 (the key is being reused for a different request)
 *  - same key, first still running → 409 (client should retry shortly)
 *  - first attempt failed (non-2xx) → the key is released so the client can fix and retry
 *
 * The key is optional; without it the request is processed normally. Keys are scoped per user.
 */
export const idempotent: RequestHandler = asyncHandler(async (req, res, next) => {
  const key = req.header('idempotency-key');
  if (!key) return next();
  if (!KEY_RE.test(key)) throw HttpError.badRequest('Idempotency-Key must be 8–128 characters of A–Z, a–z, 0–9, _ or -');
  if (!req.auth) throw HttpError.unauthorized();

  const { orgId, userId } = req.auth;
  const requestHash = createHash('sha256').update(`${req.method} ${req.baseUrl}${req.path}\n${canonicalJson(req.body ?? null)}`).digest('hex');

  // Opportunistic cleanup of expired keys.
  void prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - TTL_MS) } } }).catch(() => undefined);

  let recordId: string;
  try {
    recordId = (await prisma.idempotencyKey.create({ data: { orgId, userId, key, requestHash } })).id;
  } catch (err) {
    if ((err as { code?: string }).code !== 'P2002') throw err;
    const existing = await prisma.idempotencyKey.findUnique({ where: { orgId_userId_key: { orgId, userId, key } } });
    if (!existing) throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this key is in progress; retry shortly');
    if (existing.requestHash !== requestHash) {
      throw new HttpError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request');
    }
    if (existing.statusCode === null) {
      res.setHeader('Retry-After', '1');
      throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this key is in progress; retry shortly');
    }
    res.setHeader('Idempotent-Replayed', 'true');
    res.status(existing.statusCode).json(existing.responseBody);
    return;
  }

  // Capture the response this request produces (including errors rendered by the error handler).
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const status = res.statusCode;
    const settle =
      status >= 200 && status < 300
        ? prisma.idempotencyKey.update({ where: { id: recordId }, data: { statusCode: status, responseBody: body as never } })
        : prisma.idempotencyKey.delete({ where: { id: recordId } }); // let the client correct the request and retry
    void settle.catch(() => undefined);
    return originalJson(body);
  };
  next();
});

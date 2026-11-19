import type { RequestHandler } from 'express';
import type { AuthContext } from '../types';
import { prisma } from '../db/client';
import { HttpError } from '../lib/errors';
import { asyncHandler } from '../lib/asyncHandler';
import { verifyAccessToken } from '../modules/auth/tokens';
import { can, type Permission } from '../modules/auth/permissions';

/**
 * Requires `Authorization: Bearer <access token>` and attaches `req.auth`.
 *
 * The JWT only identifies the user. Role, organisation, facility and active-state are re-read from
 * the database on every request, so deactivating a user or changing their role takes effect
 * immediately rather than when their 15-minute token expires.
 */
export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.header('authorization');
  const match = header && /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(header);
  if (!match) throw HttpError.unauthorized();

  const claims = verifyAccessToken(match[1]);
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, orgId: true, role: true, facilityId: true, name: true, email: true, active: true },
  });
  // org mismatch = token minted for a different tenant than the user's current one.
  if (!user || !user.active || user.orgId !== claims.org) throw HttpError.unauthorized('Invalid or expired access token');

  const auth: AuthContext = {
    userId: user.id, orgId: user.orgId, role: user.role, facilityId: user.facilityId, name: user.name, email: user.email,
  };
  req.auth = auth;
  next();
});

/** Must run after `authenticate`. 403s when the caller's role lacks the permission. */
export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) return next(HttpError.unauthorized());
    if (!can(req.auth.role, permission)) return next(HttpError.forbidden());
    next();
  };

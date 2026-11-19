import { randomUUID } from 'node:crypto';
import { ROLE_SCOPES, type AuthSessionResponse, type AuthUserDto } from '../../../shared/types';
import { prisma } from '../../db/client';
import type { Prisma } from '../../db/generated/client';
import { HttpError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { appendAudit } from '../audit/append';
import { DEFAULT_RULE_PACKS } from './defaultRulePacks';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_FAMILY_MAX_DAYS,
  REFRESH_TOKEN_TTL_DAYS,
  generateRefreshToken,
  hashToken,
  signAccessToken,
} from './tokens';
import { createHash } from 'node:crypto';

const DAY_MS = 86_400_000;

/** Sign-in throttle: this many failures per email within the window blocks further attempts. */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60_000;

/**
 * A token rotated this recently is treated as a benign race (two tabs refreshing at once, a retry
 * after a dropped response): plain 401, no family revocation. The stale token still cannot be used.
 */
export const REFRESH_REUSE_LEEWAY_MS = 10_000;

export interface Session {
  response: AuthSessionResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
}

type UserWithOrg = Prisma.UserGetPayload<{ include: { org: true } }>;

export function toUserDto(u: UserWithOrg): AuthUserDto {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    affiliation: u.affiliation,
    facilityId: u.facilityId,
    organization: { id: u.org.id, name: u.org.name },
  };
}

const emailKey = (email: string) => createHash('sha256').update(email).digest('hex');

export async function issueSession(
  tx: Prisma.TransactionClient,
  user: UserWithOrg,
  family: { familyId: string; familyStart: Date },
): Promise<Session> {
  const now = Date.now();
  const refreshExpiresAt = new Date(
    Math.min(now + REFRESH_TOKEN_TTL_DAYS * DAY_MS, family.familyStart.getTime() + REFRESH_FAMILY_MAX_DAYS * DAY_MS),
  );
  const { token, tokenHash } = generateRefreshToken();
  await tx.refreshToken.create({
    data: { userId: user.id, tokenHash, familyId: family.familyId, expiresAt: refreshExpiresAt },
  });
  return {
    response: {
      accessToken: signAccessToken(user.id, user.orgId),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: toUserDto(user),
    },
    refreshToken: token,
    refreshExpiresAt,
  };
}

// ───────────────────────────── Signup ─────────────────────────────

export async function signup(input: {
  fullName: string; organization: string; email: string; password: string; pathway?: string;
}): Promise<Session> {
  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: input.organization, type: 'PROGRAMME' } });

      // Self-service signup always yields the organisation's Programme Manager. Any other role is
      // granted later by that manager (team invites), never chosen by the person signing up.
      const user = await tx.user.create({
        data: {
          orgId: org.id,
          email: input.email,
          passwordHash,
          name: input.fullName,
          role: 'PROGRAMME_MANAGER',
          affiliation: input.organization,
          accessScope: ROLE_SCOPES.PROGRAMME_MANAGER,
          lastLoginAt: new Date(),
        },
        include: { org: true },
      });

      await tx.rulePack.createMany({
        data: DEFAULT_RULE_PACKS.map((p) => ({ ...p, orgId: org.id, version: 1, clinicalOwnerId: null })),
      });

      await appendAudit(tx, {
        orgId: org.id,
        actorId: user.id,
        actorLabel: user.name,
        actorRole: 'Programme Manager',
        action: 'ORGANIZATION_CREATED',
        resourceType: 'Organization',
        resourceId: org.id,
        detail: `Organisation "${org.name}" registered${input.pathway ? ` (primary pathway: ${input.pathway})` : ''}.`,
      });

      return issueSession(tx, user, { familyId: randomUUID(), familyStart: new Date() });
    });
  } catch (err) {
    // Unique violation on User.email. (Signup necessarily reveals that an email is registered;
    // it is rate-limited per IP to keep it from being used as a bulk lookup.)
    if ((err as { code?: string }).code === 'P2002') {
      throw new HttpError(409, 'EMAIL_IN_USE', 'An account with this email already exists');
    }
    throw err;
  }
}

// ───────────────────────────── Login ─────────────────────────────

export async function login(email: string, password: string): Promise<Session> {
  const key = emailKey(email);
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);

  // Throttle first, and identically for unknown and known emails (no account enumeration).
  const recent = await prisma.loginAttempt.findMany({
    where: { keyHash: key, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: LOGIN_MAX_FAILURES,
    select: { createdAt: true },
  });
  if (recent.length >= LOGIN_MAX_FAILURES) {
    const unlockAt = recent[LOGIN_MAX_FAILURES - 1].createdAt.getTime() + LOGIN_WINDOW_MS;
    const retryAfter = Math.max(1, Math.ceil((unlockAt - Date.now()) / 1000));
    throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed sign-in attempts. Try again later.', { retryAfter });
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { org: true } });
  const ok = user && user.active ? await verifyPassword(user.passwordHash, password) : (await verifyAgainstDummy(password), false);

  if (!user || !ok) {
    await prisma.loginAttempt.create({ data: { keyHash: key } });
    // Opportunistic housekeeping so the table stays small.
    await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } } });
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  await prisma.loginAttempt.deleteMany({ where: { keyHash: key } });
  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return issueSession(tx, user, { familyId: randomUUID(), familyStart: new Date() });
  });
}

// ───────────────────────────── Refresh / logout ─────────────────────────────

/**
 * Rotates a refresh token. Each token is single-use: presenting one that was already rotated means
 * it was copied (stolen), so the whole family is revoked and the owner must sign in again.
 */
export async function refresh(presented: string): Promise<Session> {
  const tokenHash = hashToken(presented);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: { include: { org: true } } } });
  if (!row) throw HttpError.unauthorized('Invalid refresh token');

  if (row.revokedAt) {
    if (Date.now() - row.revokedAt.getTime() < REFRESH_REUSE_LEEWAY_MS) {
      throw HttpError.unauthorized('Session was just refreshed; retry with the new cookie');
    }
    // Only a *replayed* token is theft evidence: it was rotated away, yet the family still has a
    // live session (the real owner carrying on with the newer token). If the whole family is
    // already dead (logout, or an earlier reuse response) this is just a stale cookie: plain 401, no alarm.
    const stillLive = await prisma.refreshToken.count({
      where: { familyId: row.familyId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (stillLive === 0) throw HttpError.unauthorized('Session is no longer valid. Please sign in again.');

    await prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await appendAudit(tx, {
        orgId: row.user.orgId, actorId: row.userId, actorLabel: row.user.name, actorRole: 'System',
        action: 'REFRESH_TOKEN_REUSE_DETECTED', resourceType: 'User', resourceId: row.userId,
        detail: `A previously used refresh token was presented; ${count} active session token(s) revoked.`,
      });
    });
    logger.warn({ userId: row.userId, familyId: row.familyId }, 'Refresh token reuse detected');
    throw HttpError.unauthorized('Session is no longer valid. Please sign in again.');
  }
  if (row.expiresAt.getTime() <= Date.now() || !row.user.active) throw HttpError.unauthorized('Session expired');

  return prisma.$transaction(async (tx) => {
    // Atomic claim: if two requests race with the same token, exactly one wins.
    const { count } = await tx.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count !== 1) throw HttpError.unauthorized('Invalid refresh token');

    const first = await tx.refreshToken.findFirst({ where: { familyId: row.familyId }, orderBy: { createdAt: 'asc' } });
    return issueSession(tx, row.user, { familyId: row.familyId, familyStart: first?.createdAt ?? new Date() });
  });
}

/** Revokes the presented refresh token's whole family. Idempotent; unknown tokens are ignored. */
export async function logout(presented: string | undefined): Promise<void> {
  if (!presented) return;
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(presented) } });
  if (!row) return;
  await prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Revokes every session for a user (used on deactivation / password change). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

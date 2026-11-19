import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  ROLE_LABELS, ROLE_SCOPES,
  type InviteCreatedResponse, type InviteDto, type InviteLookupResponse, type TeamMemberDto, type TeamResponse, type UserRole,
} from '../../../shared/types';
import { env } from '../../config/env';
import { prisma } from '../../db/client';
import type { Invite, Prisma } from '../../db/generated/client';
import { forOrg } from '../../db/tenant';
import { HttpError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { getMailer, inviteEmail } from '../../lib/mailer';
import type { AuthContext } from '../../types';
import { appendAudit } from '../audit/append';
import { hashPassword } from '../auth/password';
import { issueSession, type Session } from '../auth/service';
import { hashToken } from '../auth/tokens';
import type { acceptInviteSchema, inviteSchema, updateMemberSchema } from './schemas';

export const INVITE_TTL_DAYS = 7;
export const MAX_PENDING_INVITES = 50;
const DAY_MS = 86_400_000;

const asTx = (tx: unknown) => tx as Prisma.TransactionClient;
const actor = (auth: AuthContext) => ({ orgId: auth.orgId, actorId: auth.userId, actorLabel: auth.name, actorRole: ROLE_LABELS[auth.role] });

/** Deliberately vague: it must not reveal whether an address already has an account somewhere. */
const emailUnavailable = () => new HttpError(409, 'EMAIL_UNAVAILABLE', 'That email address cannot be used for an invitation');
const inviteInvalid = () => new HttpError(410, 'INVITE_INVALID', 'This invitation is no longer valid. Ask your programme manager to send a new one.');

// ───────────────────────────── reading ─────────────────────────────

type InviteRow = Invite & { facility: { id: string; name: string } | null; invitedBy: { name: string } };

const toInviteDto = (i: InviteRow, now: Date): InviteDto => ({
  id: i.id, email: i.email, name: i.name, role: i.role,
  facility: i.facility ? { id: i.facility.id, name: i.facility.name } : null,
  invitedBy: i.invitedBy.name, createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString(),
  status: i.expiresAt > now ? 'PENDING' : 'EXPIRED',
});

const inviteInclude = { facility: { select: { id: true, name: true } }, invitedBy: { select: { name: true } } } as const;

export async function listTeam(auth: AuthContext): Promise<TeamResponse> {
  const db = forOrg(auth.orgId);
  const now = new Date();
  const [users, invites, owned] = await Promise.all([
    db.user.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }], include: { facility: { select: { id: true, name: true } } } }),
    db.invite.findMany({ where: { acceptedAt: null, revokedAt: null }, orderBy: { createdAt: 'desc' }, include: inviteInclude }),
    db.referralCase.groupBy({ by: ['coordinatorId'], where: { stage: { not: 'CLOSED' }, isSynthetic: false }, _count: { _all: true } }),
  ]);
  const openByUser = new Map(owned.map((o) => [o.coordinatorId, o._count._all]));

  return {
    members: users.map((u): TeamMemberDto => ({
      id: u.id, name: u.name, email: u.email, role: u.role, affiliation: u.affiliation, facility: u.facility,
      accessScope: u.accessScope, active: u.active, lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      openCases: openByUser.get(u.id) ?? 0,
    })),
    invites: invites.map((i) => toInviteDto(i as InviteRow, now)),
  };
}

// ───────────────────────────── inviting ─────────────────────────────

const inviteUrl = (token: string) => `${new URL(env.APP_URL).origin}/?invite=${token}`;

export async function createInvite(auth: AuthContext, input: z.infer<typeof inviteSchema>): Promise<InviteCreatedResponse> {
  const db = forOrg(auth.orgId);
  const token = randomBytes(32).toString('base64url');
  const now = new Date();

  // Accounts are global (one email, one account). Checked against every organisation, so the answer
  // is deliberately not distinguishable from other refusals.
  if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) throw emailUnavailable();

  const { invite, orgName } = await db.$transaction(async (tx) => {
    if (input.facilityId && !(await tx.facility.findFirst({ where: { id: input.facilityId }, select: { id: true } }))) {
      throw new HttpError(422, 'INVALID_REFERENCE', 'Unknown facility');
    }
    const pending = await tx.invite.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } });
    if (pending >= MAX_PENDING_INVITES) {
      throw new HttpError(429, 'TOO_MANY_INVITES', 'Too many invitations are waiting. Revoke some before sending more.');
    }
    // Re-inviting replaces the earlier link, which stops working.
    await tx.invite.updateMany({ where: { email: input.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } });

    const created = await tx.invite.create({
      data: {
        orgId: auth.orgId, email: input.email, name: input.name, role: input.role, facilityId: input.facilityId ?? null,
        invitedById: auth.userId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS),
      },
      include: inviteInclude,
    });
    await appendAudit(asTx(tx), {
      ...actor(auth), action: 'USER_INVITED', resourceType: 'Invite', resourceId: created.id,
      detail: `Invited ${input.name} (${input.email}) as ${ROLE_LABELS[input.role]}${created.facility ? ` at ${created.facility.name}` : ''}.`,
    });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { name: true } });
    return { invite: created as InviteRow, orgName: org.name };
  }).catch((err) => {
    if ((err as { code?: string }).code === 'P2002') throw emailUnavailable(); // lost a race with another invite/signup
    throw err;
  });

  const url = inviteUrl(token);
  const mailer = getMailer();
  let emailed = false;
  if (mailer.configured) {
    try {
      await mailer.send(inviteEmail({
        to: input.email, inviteeName: input.name, inviterName: auth.name, organization: orgName,
        roleLabel: ROLE_LABELS[input.role], url, days: INVITE_TTL_DAYS,
      }));
      emailed = true;
    } catch (err) {
      // The invitation exists either way; the inviter can still share the link by hand.
      logger.error({ err, inviteId: invite.id }, 'Could not send invitation email');
    }
  }
  return { invite: toInviteDto(invite, now), inviteUrl: url, emailed };
}

export async function revokeInvite(auth: AuthContext, id: string): Promise<void> {
  await forOrg(auth.orgId).$transaction(async (tx) => {
    const { count } = await tx.invite.updateMany({ where: { id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count !== 1) throw HttpError.notFound('Invitation not found');
    const inv = await tx.invite.findFirstOrThrow({ where: { id } });
    await appendAudit(asTx(tx), {
      ...actor(auth), action: 'USER_INVITE_REVOKED', resourceType: 'Invite', resourceId: id, detail: `Revoked the invitation for ${inv.name} (${inv.email}).`,
    });
  });
}

// ───────────────────────────── accepting (public) ─────────────────────────────

async function findValidInvite(token: string) {
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { org: { select: { name: true } }, invitedBy: { select: { name: true } }, facility: { select: { name: true } } },
  });
  // Unknown, expired, revoked and used links are indistinguishable to the caller.
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date()) throw inviteInvalid();
  return invite;
}

export async function lookupInvite(token: string): Promise<InviteLookupResponse> {
  const i = await findValidInvite(token);
  return { email: i.email, name: i.name, role: i.role, organization: i.org.name, invitedBy: i.invitedBy.name, expiresAt: i.expiresAt.toISOString() };
}

export async function acceptInvite(input: z.infer<typeof acceptInviteSchema>): Promise<Session> {
  const preview = await findValidInvite(input.token);
  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.$transaction(async (tx) => {
      // Single-use, atomically: of two simultaneous acceptances exactly one claims the invite.
      const { count } = await tx.invite.updateMany({
        where: { id: preview.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (count !== 1) throw inviteInvalid();

      const user = await tx.user.create({
        data: {
          orgId: preview.orgId, email: preview.email, passwordHash, name: input.name ?? preview.name, role: preview.role,
          facilityId: preview.facilityId, affiliation: preview.facility?.name ?? preview.org.name,
          accessScope: ROLE_SCOPES[preview.role], lastLoginAt: new Date(),
        },
        include: { org: true },
      });
      await appendAudit(tx, {
        orgId: preview.orgId, actorId: user.id, actorLabel: user.name, actorRole: ROLE_LABELS[user.role],
        action: 'USER_INVITE_ACCEPTED', resourceType: 'User', resourceId: user.id,
        detail: `${user.name} accepted the invitation and joined as ${ROLE_LABELS[user.role]}.`,
      });
      return issueSession(tx, user, { familyId: randomBytes(16).toString('hex'), familyStart: new Date() });
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw emailUnavailable(); // the address was registered after the invite was sent
    throw err;
  }
}

// ───────────────────────────── managing members ─────────────────────────────

const lastManager = () =>
  new HttpError(409, 'LAST_MANAGER', 'The organisation must keep at least one active Programme Manager. Make someone else a manager first.');

export async function updateMember(auth: AuthContext, id: string, patch: z.infer<typeof updateMemberSchema>): Promise<TeamMemberDto> {
  const db = forOrg(auth.orgId);
  await db.$transaction(async (tx) => {
    const target = await tx.user.findFirst({ where: { id } });
    if (!target) throw HttpError.notFound('Team member not found');

    const roleChanging = patch.role !== undefined && patch.role !== target.role;
    const deactivating = patch.active === false && target.active;
    const reactivating = patch.active === true && !target.active;
    const loseManager = target.role === 'PROGRAMME_MANAGER' && target.active && (roleChanging || deactivating);

    if (id === auth.userId && (roleChanging || deactivating)) {
      throw new HttpError(409, 'CANNOT_CHANGE_SELF', deactivating ? 'You cannot deactivate your own account' : 'You cannot change your own role');
    }

    if (loseManager) {
      // Lock the active managers while counting, so two managers demoting each other at once cannot both pass.
      const managers = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "User" WHERE "orgId" = ${auth.orgId} AND role = 'PROGRAMME_MANAGER' AND active FOR UPDATE`;
      if (managers.filter((m) => m.id !== id).length === 0) throw lastManager();
    }

    const newRole: UserRole = patch.role ?? target.role;
    let facilityId = patch.facilityId !== undefined ? patch.facilityId : target.facilityId;
    if (newRole === 'FACILITY_FOCAL') {
      if (!facilityId) throw new HttpError(422, 'INVALID_REFERENCE', 'Choose the facility this person works at');
      if (!(await tx.facility.findFirst({ where: { id: facilityId }, select: { id: true } }))) throw new HttpError(422, 'INVALID_REFERENCE', 'Unknown facility');
    } else {
      facilityId = null; // only focal contacts are tied to a facility
    }

    const data: Prisma.UserUncheckedUpdateInput = {};
    const notes: string[] = [];
    if (patch.name !== undefined && patch.name !== target.name) { data.name = patch.name; notes.push(`name "${target.name}" → "${patch.name}"`); }
    if (roleChanging) {
      data.role = newRole;
      data.accessScope = ROLE_SCOPES[newRole];
      notes.push(`role ${ROLE_LABELS[target.role]} → ${ROLE_LABELS[newRole]}`);
    }
    if (facilityId !== target.facilityId) data.facilityId = facilityId;
    if (deactivating || reactivating) data.active = !!patch.active;
    if (Object.keys(data).length === 0) return; // nothing changes: no write, no audit entry

    await tx.user.update({ where: { id }, data });
    if (deactivating) {
      // Take effect now: kill every session so the person is signed out everywhere.
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }

    const base = { ...actor(auth), resourceType: 'User', resourceId: id };
    if (deactivating) await appendAudit(asTx(tx), { ...base, action: 'USER_DEACTIVATED', detail: `Deactivated ${target.name}; all their sessions were ended.` });
    if (reactivating) await appendAudit(asTx(tx), { ...base, action: 'USER_REACTIVATED', detail: `Reactivated ${target.name}.` });
    if (roleChanging) await appendAudit(asTx(tx), { ...base, action: 'USER_ROLE_CHANGED', detail: `${target.name}: ${notes.filter((n) => n.startsWith('role')).join('')}.` });
    const other = notes.filter((n) => !n.startsWith('role'));
    if (other.length || (facilityId !== target.facilityId && !roleChanging)) {
      await appendAudit(asTx(tx), { ...base, action: 'USER_UPDATED', detail: `Updated ${target.name}: ${[...other, ...(facilityId !== target.facilityId && !roleChanging ? ['facility changed'] : [])].join('; ')}.` });
    }
  });

  const { members } = await listTeam(auth);
  return members.find((m) => m.id === id)!;
}

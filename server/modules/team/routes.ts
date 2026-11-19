import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { idempotent } from '../../middleware/idempotency';
import { validateBody } from '../../middleware/validate';
import { sendSession } from '../auth/routes';
import { acceptInviteSchema, inviteSchema, lookupInviteSchema, updateMemberSchema } from './schemas';
import { acceptInvite, createInvite, listTeam, lookupInvite, revokeInvite, updateMember } from './service';

const ID = /^[a-z0-9]{20,32}$/; // cuid
const noStore = (_req: unknown, res: { setHeader(n: string, v: string): void }, next: () => void) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

/** /api/users: the team directory (authenticated). */
export function usersRouter(): Router {
  const r = Router();
  r.use(authenticate, noStore);

  r.get('/', requirePermission('team.read'), asyncHandler(async (req, res) => {
    res.json(await listTeam(req.auth!));
  }));

  // The response carries the single-use link: it is returned once and never stored in plain form.
  r.post('/invite', requirePermission('team.manage'), validateBody(inviteSchema), idempotent, asyncHandler(async (req, res) => {
    res.status(201).json(await createInvite(req.auth!, req.body));
  }));

  r.post('/invites/:id/revoke', requirePermission('team.manage'), asyncHandler(async (req, res) => {
    if (!ID.test(req.params.id)) throw HttpError.notFound('Invitation not found');
    await revokeInvite(req.auth!, req.params.id);
    res.status(204).end();
  }));

  r.patch('/:id', requirePermission('team.manage'), validateBody(updateMemberSchema), asyncHandler(async (req, res) => {
    if (!ID.test(req.params.id)) throw HttpError.notFound('Team member not found');
    res.json(await updateMember(req.auth!, req.params.id, req.body));
  }));

  return r;
}

/**
 * /api/invites: used by the person being invited, before they have an account (public).
 * The token travels in the request BODY, never the URL, so it stays out of access logs.
 */
export function invitesRouter(opts: { maxPerIp?: number } = {}): Router {
  const r = Router();
  r.use(noStore);
  r.use(rateLimit({
    windowMs: 15 * 60_000, limit: opts.maxPerIp ?? 30, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (_q, _s, next) => next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.')),
  }));

  r.post('/lookup', validateBody(lookupInviteSchema), asyncHandler(async (req, res) => {
    res.json(await lookupInvite(req.body.token));
  }));

  r.post('/accept', validateBody(acceptInviteSchema), asyncHandler(async (req, res) => {
    sendSession(res, await acceptInvite(req.body), 201);
  }));

  return r;
}

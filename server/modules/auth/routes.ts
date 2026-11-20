import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { AuthSessionResponse } from '../../../shared/types';
import { isProd } from '../../config/env';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/errors';
import { authenticate } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { prisma } from '../../db/client';
import { loginSchema, signupSchema } from './schemas';
import * as auth from './service';

export const REFRESH_COOKIE = 'pathora_rt';
/** Scoped to the auth routes so the refresh token is never sent with ordinary API calls. */
const COOKIE_PATH = '/api/auth';

function setRefreshCookie(res: Response, session: auth.Session) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: COOKIE_PATH,
    expires: session.refreshExpiresAt,
  });
}

const clearRefreshCookie = (res: Response) =>
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: isProd, sameSite: 'strict', path: COOKIE_PATH });

export function sendSession(res: Response, session: auth.Session, status = 200) {
  setRefreshCookie(res, session);
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(session.response satisfies AuthSessionResponse);
}

export interface AuthRouterOptions {
  /** Per-IP request caps (a broad abuse guard; per-account throttling lives in the login service). */
  loginMaxPerIp?: number;
  signupMaxPerIp?: number;
}

export function authRouter(opts: AuthRouterOptions = {}): Router {
  const router = Router();
  const limiter = (max: number, windowMs: number) =>
    rateLimit({
      windowMs,
      limit: max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.')),
    });

  router.post(
    '/signup',
    limiter(opts.signupMaxPerIp ?? 10, 60 * 60_000),
    validateBody(signupSchema),
    asyncHandler(async (req, res) => sendSession(res, await auth.signup(req.body), 201)),
  );

  router.post(
    '/login',
    limiter(opts.loginMaxPerIp ?? 30, 15 * 60_000),
    validateBody(loginSchema),
    asyncHandler(async (req, res) => {
      try {
        sendSession(res, await auth.login(req.body.email, req.body.password));
      } catch (err) {
        if (err instanceof HttpError && err.status === 429) {
          const retryAfter = (err.details as { retryAfter?: number } | undefined)?.retryAfter;
          if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
        }
        throw err;
      }
    }),
  );

  router.post(
    '/refresh',
    limiter(opts.loginMaxPerIp ?? 30, 15 * 60_000),
    asyncHandler(async (req, res) => {
      const presented = req.cookies?.[REFRESH_COOKIE];
      if (typeof presented !== 'string' || !presented) throw HttpError.unauthorized('No session');
      try {
        sendSession(res, await auth.refresh(presented));
      } catch (err) {
        clearRefreshCookie(res); // a dead token should not keep being replayed by the browser
        throw err;
      }
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      await auth.logout(req.cookies?.[REFRESH_COOKIE]);
      clearRefreshCookie(res);
      res.status(204).end();
    }),
  );

  router.get(
    '/me',
    authenticate,
    asyncHandler(async (req, res) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, include: { org: true } });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ user: auth.toUserDto(user) });
    }),
  );

  return router;
}

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/errors';
import { validateBody } from '../../middleware/validate';
import { leadSchema, submitLead } from './service';

/** Public (no sign-in), so the per-IP cap is deliberately tight: a person submits this form once. */
export function leadsRouter(opts: { maxPerIp?: number } = {}): Router {
  const r = Router();
  r.post(
    '/',
    rateLimit({
      windowMs: 60 * 60_000,
      limit: opts.maxPerIp ?? 5,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.')),
    }),
    validateBody(leadSchema),
    asyncHandler(async (req, res) => {
      await submitLead(req.body);
      res.setHeader('Cache-Control', 'no-store');
      res.status(202).json({ ok: true });
    }),
  );
  return r;
}

import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { applyDeliveryReceipt, applyInboundReply, webhookSecretMatches, webhooksConfigured } from './webhooks';
import { approveTemplate, createTemplate, createTemplateSchema, listTemplates, retireTemplate, updateTemplate, updateTemplateSchema } from './templates';
import { commsLogQuerySchema, listCommsLog } from './messages';

const ID = /^[a-z0-9]{20,32}$/; // cuid
const noStore = (_req: unknown, res: { setHeader(n: string, v: string): void }, next: () => void) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
const idOf = (raw: string) => {
  if (!ID.test(raw)) throw HttpError.notFound('Template not found');
  return raw;
};

/** /api/templates: the approved wording staff may send to patients. */
export function templatesRouter(): Router {
  const r = Router();
  r.use(authenticate, noStore);
  r.get('/', requirePermission('comms.read'), asyncHandler(async (req, res) => res.json({ templates: await listTemplates(req.auth!) })));
  r.post('/', requirePermission('templates.manage'), validateBody(createTemplateSchema), asyncHandler(async (req, res) => res.status(201).json(await createTemplate(req.auth!, req.body))));
  r.patch('/:id', requirePermission('templates.manage'), validateBody(updateTemplateSchema), asyncHandler(async (req, res) => res.json(await updateTemplate(req.auth!, idOf(req.params.id), req.body))));
  // Approval is the clinical lead's decision alone: staff draft, the clinical lead approves.
  r.post('/:id/approve', requirePermission('templates.approve'), asyncHandler(async (req, res) => res.json(await approveTemplate(req.auth!, idOf(req.params.id)))));
  r.post('/:id/retire', requirePermission('templates.manage'), asyncHandler(async (req, res) => res.json(await retireTemplate(req.auth!, idOf(req.params.id)))));
  return r;
}

/** /api/comms-log: what was sent, and what became of it. */
export function commsLogRouter(): Router {
  const r = Router();
  r.use(authenticate, noStore);
  r.get('/', requirePermission('comms.read'), asyncHandler(async (req, res) => res.json(await listCommsLog(req.auth!, commsLogQuerySchema.parse(req.query)))));
  return r;
}

/**
 * /api/webhooks/messaging: callbacks from the SMS provider (delivery receipts, patient replies).
 * Authenticated by a shared secret on the URL (?secret=…), since providers cannot send our login tokens.
 * They always answer 200 once authenticated, so the provider does not retry forever on a message we do not know.
 */
export function messagingWebhooksRouter(): Router {
  const r = Router();
  r.use(
    rateLimit({ windowMs: 60_000, limit: 1200, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_q, _s, next) => next(new HttpError(429, 'RATE_LIMITED', 'Too many requests.')) }),
    express.urlencoded({ extended: false, limit: '20kb' }), // providers post forms
    noStore,
    (req, _res, next) => {
      if (!webhooksConfigured()) return next(new HttpError(503, 'WEBHOOKS_DISABLED', 'Messaging callbacks are not configured'));
      const given = typeof req.query.secret === 'string' ? req.query.secret : req.header('x-webhook-secret');
      next(webhookSecretMatches(given) ? undefined : HttpError.unauthorized('Invalid webhook secret'));
    },
  );

  const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');

  r.post('/delivery', asyncHandler(async (req, res) => {
    const b = req.body ?? {};
    await applyDeliveryReceipt({ providerMessageId: str(b.id ?? b.messageId, 100), status: str(b.status, 40), failureReason: str(b.failureReason, 200) || undefined });
    res.json({ ok: true });
  }));

  r.post('/inbound', asyncHandler(async (req, res) => {
    const b = req.body ?? {};
    await applyInboundReply({ from: str(b.from, 40), text: str(b.text, 1000), providerMessageId: str(b.id ?? b.messageId, 100) || `inbound-${Date.now()}` });
    res.json({ ok: true });
  }));

  return r;
}

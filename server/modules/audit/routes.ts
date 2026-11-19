import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticate, requirePermission } from '../../middleware/auth';
import { auditQuerySchema, listAudit, verifyChain } from './service';

export function auditRouter(): Router {
  const r = Router();
  r.use(authenticate, requirePermission('audit.read'));
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  r.get('/', asyncHandler(async (req, res) => {
    res.json(await listAudit(req.auth!, auditQuerySchema.parse(req.query)));
  }));

  // Declared before any `/:id` style route could shadow it.
  r.get('/verify', asyncHandler(async (req, res) => {
    res.json(await verifyChain(req.auth!));
  }));

  return r;
}

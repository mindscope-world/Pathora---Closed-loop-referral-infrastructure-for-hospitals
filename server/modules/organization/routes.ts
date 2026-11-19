import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { getOrganization, updateOrganization, updateOrganizationSchema } from './service';

export function organizationRouter(): Router {
  const r = Router();
  r.use(authenticate);
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  r.get('/', requirePermission('org.read'), asyncHandler(async (req, res) => res.json(await getOrganization(req.auth!))));
  r.patch('/', requirePermission('org.manage'), validateBody(updateOrganizationSchema), asyncHandler(async (req, res) => {
    res.json(await updateOrganization(req.auth!, req.body));
  }));
  return r;
}

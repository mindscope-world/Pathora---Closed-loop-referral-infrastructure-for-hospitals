import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { createFacility, createFacilitySchema, listFacilities, updateFacility, updateFacilitySchema } from './service';

const ID = /^[a-z0-9]{20,32}$/; // cuid

export function facilitiesRouter(): Router {
  const r = Router();
  r.use(authenticate);
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  r.get('/', requirePermission('facilities.read'), asyncHandler(async (req, res) => {
    res.json({ facilities: await listFacilities(req.auth!) });
  }));

  r.post('/', requirePermission('facilities.manage'), validateBody(createFacilitySchema), asyncHandler(async (req, res) => {
    res.status(201).json(await createFacility(req.auth!, req.body));
  }));

  r.patch('/:id', requirePermission('facilities.manage'), validateBody(updateFacilitySchema), asyncHandler(async (req, res) => {
    if (!ID.test(req.params.id)) throw HttpError.notFound('Facility not found');
    res.json(await updateFacility(req.auth!, req.params.id, req.body));
  }));

  return r;
}

import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { erasePatient, erasureSchema, PATIENT_CODE, subjectAccessExport } from './service';

/** Data-subject requests. DPO only: this is the most sensitive read in the product. */
export function privacyRouter(): Router {
  const r = Router();
  r.use(authenticate, requirePermission('privacy.manage'));
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const code = (v: string) => {
    if (!PATIENT_CODE.test(v)) throw HttpError.notFound('No patient with that code');
    return v;
  };

  r.get('/patients/:patientCode/export', asyncHandler(async (req, res) => {
    res.json(await subjectAccessExport(req.auth!, code(req.params.patientCode)));
  }));
  r.post('/patients/:patientCode/erasure', validateBody(erasureSchema), asyncHandler(async (req, res) => {
    res.json(await erasePatient(req.auth!, code(req.params.patientCode), req.body.reason));
  }));
  return r;
}

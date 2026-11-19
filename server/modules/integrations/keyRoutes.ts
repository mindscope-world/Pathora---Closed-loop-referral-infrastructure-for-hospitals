import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { createKey, createKeySchema, listKeys, revokeKey } from './keys';

const ID = /^[a-z0-9]{20,32}$/; // cuid

/** Mounted at /facilities/:facilityId/api-keys. Managing facility credentials is a manager-only act. */
export function apiKeysRouter(): Router {
  const r = Router({ mergeParams: true });
  r.use(authenticate, requirePermission('integrations.manage'));
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); // the create response carries secrets
    next();
  });
  const facilityId = (req: { params: Record<string, string> }) => {
    if (!ID.test(req.params.facilityId)) throw HttpError.notFound('Facility not found');
    return req.params.facilityId;
  };

  r.get('/', asyncHandler(async (req, res) => {
    res.json({ keys: await listKeys(req.auth!, facilityId(req)) });
  }));
  r.post('/', validateBody(createKeySchema), asyncHandler(async (req, res) => {
    res.status(201).json(await createKey(req.auth!, facilityId(req), req.body));
  }));
  r.delete('/:keyId', asyncHandler(async (req, res) => {
    if (!ID.test(req.params.keyId)) throw HttpError.notFound('API key not found');
    await revokeKey(req.auth!, facilityId(req), req.params.keyId);
    res.status(204).end();
  }));
  return r;
}

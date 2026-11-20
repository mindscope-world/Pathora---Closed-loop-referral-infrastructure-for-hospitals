import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/errors';
import { authenticate } from '../../middleware/auth';
import { listNotifications, markAllRead, markRead } from './service';

const ID = /^[a-z0-9]{20,32}$/; // cuid

export function notificationsRouter(): Router {
  const r = Router();
  r.use(authenticate);
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  r.get('/', asyncHandler(async (req, res) => res.json(await listNotifications(req.auth!))));

  // Declared before '/:id/read' so 'read-all' is never mistaken for an id.
  r.post('/read-all', asyncHandler(async (req, res) => res.json({ marked: await markAllRead(req.auth!) })));

  r.post('/:id/read', asyncHandler(async (req, res) => {
    if (!ID.test(req.params.id)) throw HttpError.notFound('Notification not found');
    await markRead(req.auth!, req.params.id);
    res.status(204).end();
  }));

  return r;
}

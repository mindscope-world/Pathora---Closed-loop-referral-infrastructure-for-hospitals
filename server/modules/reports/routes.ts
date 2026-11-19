import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { createSchedule, createScheduleSchema, deleteSchedule, listSchedules, setScheduleEnabled, updateScheduleSchema } from './service';

const ID = /^[a-z0-9]{20,32}$/; // cuid

/** Scheduling a report is the same act as requesting an export, so it needs the same permission. */
export function reportSchedulesRouter(): Router {
  const r = Router();
  r.use(authenticate, requirePermission('exports.create'));
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  r.get('/', asyncHandler(async (req, res) => {
    res.json({ schedules: await listSchedules(req.auth!) });
  }));
  r.post('/', validateBody(createScheduleSchema), asyncHandler(async (req, res) => {
    res.status(201).json(await createSchedule(req.auth!, req.body));
  }));
  r.patch('/:id', validateBody(updateScheduleSchema), asyncHandler(async (req, res) => {
    if (!ID.test(req.params.id)) throw HttpError.notFound('Scheduled report not found');
    res.json(await setScheduleEnabled(req.auth!, req.params.id, req.body.enabled));
  }));
  r.delete('/:id', asyncHandler(async (req, res) => {
    if (!ID.test(req.params.id)) throw HttpError.notFound('Scheduled report not found');
    await deleteSchedule(req.auth!, req.params.id);
    res.status(204).end();
  }));
  return r;
}

import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticate, requirePermission } from '../../middleware/auth';
import { overviewMetrics, upcomingMetrics } from './service';

export function metricsRouter(): Router {
  const r = Router();
  r.use(authenticate, requirePermission('metrics.read'));
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  r.get('/overview', asyncHandler(async (req, res) => {
    res.json(await overviewMetrics(req.auth!, new Date()));
  }));

  r.get('/upcoming', asyncHandler(async (req, res) => {
    res.json(await upcomingMetrics(req.auth!, new Date()));
  }));

  return r;
}

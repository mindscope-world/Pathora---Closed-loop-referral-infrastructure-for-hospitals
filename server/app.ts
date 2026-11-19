import express, { type Express, type RequestHandler, Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { HealthResponse } from '../shared/types';
import { env } from './config/env';
import { logger } from './lib/logger';
import { requestId } from './middleware/requestId';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRouter, type AuthRouterOptions } from './modules/auth/routes';
import { casesRouter, facilitiesRouter, searchRouter } from './modules/cases/routes';

const healthz: RequestHandler = (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
  res.setHeader('Cache-Control', 'no-store');
  res.json(body);
};

export interface AppOptions {
  auth?: AuthRouterOptions;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const allowedOrigin = new URL(env.APP_URL).origin;

  app.disable('x-powered-by');
  // Behind Cloud Run / a load balancer; needed for correct client IPs in rate limiting.
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/api/healthz' },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      // Requests with no Origin (curl, server-to-server, same-origin GET) are allowed through;
      // browsers always send Origin on cross-origin requests.
      origin: (origin, cb) =>
        !origin || origin === allowedOrigin ? cb(null, true) : cb(new Error('CORS_ORIGIN_DENIED')),
      credentials: true,
    }),
  );
  // CSV batch import legitimately exceeds the default cap. This must be mounted BEFORE the global
  // parser: body-parser only runs once per request, so a route-level parser added later never sees the body.
  app.use('/api/cases/import', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser(env.COOKIE_SECRET));

  app.get('/healthz', healthz);

  const api = Router();
  api.get('/healthz', healthz);
  api.use('/auth', authRouter(options.auth));
  api.use('/cases', casesRouter());
  api.use('/facilities', facilitiesRouter());
  api.use('/search', searchRouter());
  // Further feature routers (comms, rule packs, audit...) are mounted here in later phases.
  app.use('/api', api);
  app.use('/api', notFoundHandler);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

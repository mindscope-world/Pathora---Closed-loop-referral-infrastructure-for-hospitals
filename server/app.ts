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
import { casesRouter, searchRouter } from './modules/cases/routes';
import { facilitiesRouter } from './modules/facilities/routes';
import { organizationRouter } from './modules/organization/routes';
import { invitesRouter, usersRouter } from './modules/team/routes';
import { auditRouter } from './modules/audit/routes';
import { exportsRouter } from './modules/exports/routes';
import { redactToken } from './modules/exports/signedUrl';
import { processPending } from './jobs/exportWorker';
import pino from 'pino';

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
  invites?: { maxPerIp?: number };
  exports?: {
    /** Called after an export is queued so it starts promptly. Tests replace it to drive the worker by hand. */
    kick?: () => void;
  };
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
      serializers: {
        // Export download links carry a signed token in the query string; keep it out of the logs.
        req: (req) => {
          const out = pino.stdSerializers.req(req);
          out.url = redactToken(out.url);
          return out;
        },
      },
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
  api.use('/organization', organizationRouter());
  api.use('/users', usersRouter());
  api.use('/invites', invitesRouter({ maxPerIp: options.invites?.maxPerIp }));
  api.use('/search', searchRouter());
  api.use('/audit', auditRouter());
  api.use(
    '/exports',
    exportsRouter({
      kick: options.exports?.kick ?? (() => void processPending().catch((err) => logger.error({ err }, 'Export run failed'))),
    }),
  );
  // Further feature routers (comms, rule packs, audit...) are mounted here in later phases.
  app.use('/api', api);
  app.use('/api', notFoundHandler);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

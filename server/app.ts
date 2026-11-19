import express, { type Express, type RequestHandler, Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { HealthResponse } from '../shared/types';
import { env, isProd } from './config/env';
import { logger } from './lib/logger';
import { requestId } from './middleware/requestId';
import { staticSite } from './middleware/staticSite';
import { observeRequest, routeLabel } from './lib/metrics';
import { opsRouter } from './modules/ops/routes';
import { privacyRouter } from './modules/privacy/routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRouter, type AuthRouterOptions } from './modules/auth/routes';
import { casesRouter, escalationsRouter, searchRouter } from './modules/cases/routes';
import { notificationsRouter } from './modules/notifications/routes';
import { rulePacksRouter } from './modules/rulepacks/routes';
import { facilitiesRouter } from './modules/facilities/routes';
import { organizationRouter } from './modules/organization/routes';
import { commsLogRouter, messagingWebhooksRouter, templatesRouter } from './modules/comms/routes';
import { kickMessageWorker } from './jobs/messageWorker';
import { invitesRouter, usersRouter } from './modules/team/routes';
import { auditRouter } from './modules/audit/routes';
import { exportsRouter } from './modules/exports/routes';
import { apiKeysRouter } from './modules/integrations/keyRoutes';
import { integrationsRouter } from './modules/integrations/routes';
import { leadsRouter } from './modules/leads/routes';
import { metricsRouter } from './modules/metrics/routes';
import { reportSchedulesRouter } from './modules/reports/routes';
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
  leads?: { maxPerIp?: number };
  integrations?: { maxFailedPerIp?: number; maxPerKey?: number };
  /** Override TRUST_PROXY (tests). */
  trustProxy?: number | string;
  /** Folder holding the built frontend. Defaults to STATIC_DIR, or ./dist in production; none in development/tests. */
  staticDir?: string;
  messages?: {
    /** Called after a message is queued so it goes out promptly. Tests replace it to drive the worker by hand. */
    kick?: () => void;
  };
  exports?: {
    /** Called after an export is queued so it starts promptly. Tests replace it to drive the worker by hand. */
    kick?: () => void;
  };
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const allowedOrigin = new URL(env.APP_URL).origin;

  app.disable('x-powered-by');
  // Behind a platform load balancer; needed for correct client IPs in rate limiting. Configurable (TRUST_PROXY) because
  // the number of proxies differs per host, and getting it wrong breaks every per-IP limit.
  app.set('trust proxy', options.trustProxy ?? env.TRUST_PROXY);

  app.use(requestId);
  // Traffic metrics. The route label is the matched TEMPLATE (e.g. /api/cases/:ref/acknowledge), never the real URL, so
  // referral numbers and other identifiers cannot reach the metrics; unmatched paths share one label.
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      observeRequest(req.method, routeLabel(req), res.statusCode, Number(process.hrtime.bigint() - start) / 1e9);
    });
    next();
  });
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
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // React and the animation library set inline style attributes; fonts come from Google Fonts (index.html).
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          ...(isProd ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      // Patient data pages must not be embedded or sniffed; HSTS applies once served over https.
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
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
  // Facility integrations sign the exact bytes they send, so these routes keep the body raw (mounted before the JSON parser).
  app.use('/api/integrations', express.raw({ type: () => true, limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser(env.COOKIE_SECRET));

  app.get('/healthz', healthz);
  app.use(opsRouter()); // /readyz and /metrics

  const api = Router();
  api.get('/healthz', healthz);
  api.use('/auth', authRouter(options.auth));
  const kickMessages = options.messages?.kick ?? kickMessageWorker;
  api.use('/cases', casesRouter({ kickMessages }));
  api.use('/templates', templatesRouter());
  api.use('/comms-log', commsLogRouter());
  api.use('/webhooks/messaging', messagingWebhooksRouter());
  api.use('/facilities/:facilityId/api-keys', apiKeysRouter());
  api.use('/facilities', facilitiesRouter());
  api.use('/integrations/v1', integrationsRouter(options.integrations));
  api.use('/organization', organizationRouter());
  api.use('/users', usersRouter());
  api.use('/invites', invitesRouter({ maxPerIp: options.invites?.maxPerIp }));
  api.use('/search', searchRouter());
  api.use('/escalations', escalationsRouter());
  api.use('/rule-packs', rulePacksRouter());
  api.use('/notifications', notificationsRouter());
  api.use('/audit', auditRouter());
  api.use('/privacy', privacyRouter());
  api.use('/leads', leadsRouter({ maxPerIp: options.leads?.maxPerIp }));
  api.use('/metrics', metricsRouter());
  api.use('/report-schedules', reportSchedulesRouter());
  api.use(
    '/exports',
    exportsRouter({
      kick: options.exports?.kick ?? (() => void processPending().catch((err) => logger.error({ err }, 'Export run failed'))),
    }),
  );
  // Further feature routers (comms, rule packs, audit...) are mounted here in later phases.
  app.use('/api', api);
  app.use('/api', notFoundHandler);

  const staticDir = options.staticDir ?? env.STATIC_DIR ?? (isProd ? 'dist' : undefined);
  if (staticDir) {
    const site = staticSite(staticDir);
    if (site) app.use(site);
    else logger.warn({ staticDir }, 'No built frontend found; only the API is being served');
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

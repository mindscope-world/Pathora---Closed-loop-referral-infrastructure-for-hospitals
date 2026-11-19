import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { env } from '../../config/env';
import { prisma } from '../../db/client';
import { asyncHandler } from '../../lib/asyncHandler';
import { renderMetrics, type Gauge } from '../../lib/metrics';

const sha = (v: string) => createHash('sha256').update(v).digest();
const tokenOk = (given: string | undefined) => Boolean(env.METRICS_TOKEN && given && timingSafeEqual(sha(env.METRICS_TOKEN), sha(given)));
const age = (d: Date | null | undefined, now: Date) => (d ? Math.max(0, (now.getTime() - d.getTime()) / 1000) : 0);

/** Queue depths and failure counts, read at scrape time. Aggregates across the whole deployment: no organisation, person or referral appears. */
export async function collectGauges(now: Date = new Date()): Promise<Gauge[]> {
  const day = new Date(now.getTime() - 86_400_000);
  const [exportPending, exportRunning, exportFailed, oldestExport, msgQueued, oldestMsg, msgFailed, msgHuman, breaches, schedulesLate] = await Promise.all([
    prisma.exportJob.count({ where: { status: 'PENDING' } }),
    prisma.exportJob.count({ where: { status: 'RUNNING' } }),
    prisma.exportJob.count({ where: { status: 'FAILED', completedAt: { gte: day } } }),
    prisma.exportJob.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    prisma.commsLog.count({ where: { status: 'QUEUED' } }),
    prisma.commsLog.findFirst({ where: { status: 'QUEUED', nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: 'asc' }, select: { nextAttemptAt: true } }),
    prisma.commsLog.count({ where: { status: 'FAILED', updatedAt: { gte: day } } }),
    prisma.commsLog.count({ where: { status: 'HUMAN_ROUTED', updatedAt: { gte: day } } }),
    prisma.slaBreach.count({ where: { detectedAt: { gte: day } } }),
    prisma.reportSchedule.count({ where: { enabled: true, nextRunAt: { lt: new Date(now.getTime() - 10 * 60_000) } } }),
  ]);
  return [
    { name: 'pathora_db_up', help: '1 when the database answered this scrape.', samples: [{ value: 1 }] },
    { name: 'pathora_export_jobs', help: 'Export jobs waiting or running.', samples: [{ labels: { status: 'pending' }, value: exportPending }, { labels: { status: 'running' }, value: exportRunning }] },
    { name: 'pathora_export_jobs_failed_24h', help: 'Export jobs that failed in the last 24 hours.', samples: [{ value: exportFailed }] },
    { name: 'pathora_export_oldest_pending_age_seconds', help: 'Age of the oldest export still waiting (0 when none).', samples: [{ value: age(oldestExport?.createdAt, now) }] },
    { name: 'pathora_messages_queued', help: 'Patient messages queued for sending.', samples: [{ value: msgQueued }] },
    { name: 'pathora_messages_overdue_age_seconds', help: 'How long the oldest DUE queued message has been waiting (0 when none): send lag.', samples: [{ value: age(oldestMsg?.nextAttemptAt, now) }] },
    { name: 'pathora_messages_failed_24h', help: 'Messages that failed in the last 24 hours (send failures).', samples: [{ value: msgFailed }] },
    { name: 'pathora_messages_human_routed_24h', help: 'Messages handed to a person in the last 24 hours.', samples: [{ value: msgHuman }] },
    { name: 'pathora_sla_breaches_detected_24h', help: 'SLA breaches the monitor recorded in the last 24 hours.', samples: [{ value: breaches }] },
    { name: 'pathora_report_schedules_late', help: 'Scheduled reports more than 10 minutes past due.', samples: [{ value: schedulesLate }] },
  ];
}

/** Liveness is /healthz (the process is up). Readiness: this instance can reach its database. No detail is disclosed on failure. */
export function opsRouter(): Router {
  const r = Router();

  r.get('/readyz', asyncHandler(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  }));

  // Operator endpoints: they exist only when METRICS_TOKEN is set, and need it as a bearer token.
  const operatorOnly: RequestHandler = (req, res, next) => {
    if (!env.METRICS_TOKEN) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } }); // disabled: indistinguishable from absent
    const m = /^Bearer (\S+)$/.exec(req.header('authorization') ?? '');
    if (!tokenOk(m?.[1])) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  };

  /**
   * What address does the app think the caller has? After deploying behind a platform load balancer, call this from your own
   * machine: `ip` must be YOUR public address. If it is the platform's, raise TRUST_PROXY; if `ip` is a value you could have
   * forged with your own X-Forwarded-For header, lower it. Only the caller's own address is returned.
   */
  r.get('/diagnostics/client-ip', operatorOnly, (req, res) => {
    res.json({ ip: req.ip ?? null, forwardedChain: req.ips, xForwardedFor: req.header('x-forwarded-for') ?? null, trustProxy: req.app.get('trust proxy') });
  });

  r.get('/metrics', operatorOnly, asyncHandler(async (_req, res) => {
    let gauges: Gauge[];
    try {
      gauges = await collectGauges();
    } catch {
      gauges = [{ name: 'pathora_db_up', help: '1 when the database answered this scrape.', samples: [{ value: 0 }] }];
    }
    res.setHeader('Cache-Control', 'no-store');
    res.type('text/plain; version=0.0.4; charset=utf-8').send(renderMetrics(gauges));
  }));
  return r;
}

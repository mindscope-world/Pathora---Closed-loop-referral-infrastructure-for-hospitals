import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../config/env';
import { recordJobRun, renderMetrics, resetMetrics, routeLabel } from '../../lib/metrics';
import { prisma } from '../../test/helpers';
import { app, as, createCase, makeWorkspace, type Workspace } from '../../test/workspace';

const TOKEN = 'metrics-token-for-tests-0123456789';
const setToken = (v?: string) => ((env as { METRICS_TOKEN?: string }).METRICS_TOKEN = v);
let ws: Workspace;
beforeAll(async () => {
  ws = await makeWorkspace();
});
afterAll(() => prisma.$disconnect());
beforeEach(() => {
  resetMetrics();
  setToken(TOKEN);
});
afterEach(() => setToken(undefined));

const scrape = (token: string | null = TOKEN) => {
  const r = request(app).get('/metrics');
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const value = (text: string, series: string) => {
  const line = text.split('\n').find((l) => l.startsWith(`${series} `) || l.startsWith(`${series}{`));
  return line ? Number(line.split(' ').pop()) : null;
};

describe('readiness', () => {
  it('/readyz reports ready when the database answers, with no detail', async () => {
    const res = await request(app).get('/readyz').expect(200);
    expect(res.body).toEqual({ status: 'ready' });
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('/healthz stays a pure liveness check', async () => {
    expect((await request(app).get('/healthz').expect(200)).body.status).toBe('ok');
  });
});

describe('/metrics access', () => {
  it('does not exist when no token is configured', async () => {
    setToken(undefined);
    expect((await scrape()).status).toBe(404);
    expect((await scrape(null)).status).toBe(404);
  });
  it('needs the exact bearer token', async () => {
    expect((await scrape(null)).status).toBe(401);
    expect((await scrape('wrong-token-wrong-token-wrong')).status).toBe(401);
    expect((await scrape(`${TOKEN}x`)).status).toBe(401);
    expect((await request(app).get('/metrics').set(as(ws.manager))).status).toBe(401); // a user's session is not a scraper
    expect((await scrape(null)).headers['www-authenticate']).toBe('Bearer');
    const ok = await scrape();
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('text/plain');
    expect(ok.headers['cache-control']).toBe('no-store');
  });
});

describe('/metrics content', () => {
  it('exposes queue depths and failure counts', async () => {
    const c = await createCase(ws, { patientName: 'Queue Patient' });
    const row = await prisma.referralCase.findFirstOrThrow({ where: { orgId: ws.orgId, refNumber: c.id } });
    const log = (status: string, extra: object = {}) => prisma.commsLog.create({ data: { orgId: ws.orgId, caseId: row.id, patientId: row.patientId, channel: 'SMS', templateName: 'T', status: status as 'QUEUED', ...extra } });
    await log('QUEUED', { nextAttemptAt: new Date(Date.now() - 90_000) });
    await log('FAILED');
    await prisma.exportJob.create({ data: { orgId: ws.orgId, type: 'CASES_CSV', requestedBy: ws.manager.id, fileName: 'x.csv' } });

    const text = (await scrape()).text;
    expect(value(text, 'pathora_db_up')).toBe(1);
    expect(value(text, 'pathora_messages_queued')).toBeGreaterThanOrEqual(1);
    expect(value(text, 'pathora_messages_overdue_age_seconds')).toBeGreaterThanOrEqual(80);
    expect(value(text, 'pathora_messages_failed_24h')).toBeGreaterThanOrEqual(1);
    expect(value(text, 'pathora_export_jobs{status="pending"}')).toBeGreaterThanOrEqual(1);
    expect(value(text, 'pathora_export_oldest_pending_age_seconds')).toBeGreaterThanOrEqual(0);
    expect(text).toContain('# TYPE pathora_messages_queued gauge');
    await prisma.exportJob.deleteMany({ where: { orgId: ws.orgId, fileName: 'x.csv' } }); // do not leave a queued job for other tests
  });

  it('shows job health: runs, errors and a lag that grows when a job stops succeeding', async () => {
    recordJobRun('sla_monitor', true, new Date(Date.now() - 600_000));
    recordJobRun('sla_monitor', false);
    recordJobRun('message_worker', true);
    const text = (await scrape()).text;
    expect(value(text, 'pathora_job_runs_total{job="sla_monitor"}')).toBe(2);
    expect(value(text, 'pathora_job_errors_total{job="sla_monitor"}')).toBe(1);
    expect(value(text, 'pathora_job_lag_seconds{job="sla_monitor"}')).toBeGreaterThanOrEqual(599); // last SUCCESS was 10 minutes ago
    expect(value(text, 'pathora_job_lag_seconds{job="message_worker"}')).toBeLessThan(5);
  });

  it('counts requests by route TEMPLATE and status class, never by the real URL', async () => {
    const c = await createCase(ws, { patientName: 'Template Patient' });
    await request(app).get(`/api/cases/${c.id}`).set(as(ws.manager)).expect(200);
    await request(app).get('/api/cases/REF-0000-0000').set(as(ws.manager)).expect(404);
    await request(app).get('/api/definitely/not/a/route').set(as(ws.manager)).expect(404);
    await request(app).get('/api/cases').expect(401);
    const text = (await scrape()).text;
    expect(text).toMatch(/pathora_http_requests_total\{method="GET",route="\/api\/cases\/:id",status="2xx"\} 1/);
    expect(text).toMatch(/route="\/api\/cases\/:id",status="4xx"\} 1/);
    expect(text).toContain('route="unmatched"');
    expect(text).toContain('pathora_http_request_duration_seconds_bucket');
    expect(text).not.toContain(c.id);
    expect(text).not.toContain('REF-0000-0000');
    expect(text).not.toContain('definitely');
  });

  it('discloses no organisation, person, referral or facility', async () => {
    await createCase(ws, { patientName: 'Disclosure Patient', patientCode: 'PT-DISC1' });
    const text = (await scrape()).text;
    for (const needle of [ws.orgId, ws.facilityA.name, 'Disclosure', 'PT-DISC1', '@', 'REF-']) expect(text).not.toContain(needle);
  });

  it('degrades to db_up 0 instead of failing the scrape when a query throws', async () => {
    const original = prisma.exportJob.count;
    (prisma.exportJob as { count: unknown }).count = () => Promise.reject(new Error('db down'));
    try {
      const res = await scrape();
      expect(res.status).toBe(200);
      expect(value(res.text, 'pathora_db_up')).toBe(0);
    } finally {
      (prisma.exportJob as { count: unknown }).count = original;
    }
  });
});

describe('metrics rendering', () => {
  it('escapes label values and renders histogram buckets cumulatively', () => {
    resetMetrics();
    recordJobRun('weird"job\\name\n', true);
    const text = renderMetrics([{ name: 'x_gauge', help: 'h', samples: [{ labels: { a: 'b"c' }, value: 3 }] }]);
    expect(text).toContain('job="weird\\"job\\\\name\\n"');
    expect(text).toContain('x_gauge{a="b\\"c"} 3');
  });
});

describe('route labels', () => {
  const label = (path: string, url: string) => routeLabel({ route: { path }, originalUrl: url });
  it('uses the template and never an identifier, even in a mount prefix', () => {
    expect(label('/:id', '/api/cases/REF-2026-0001?x=1')).toBe('/api/cases/:id');
    expect(label('/:id/acknowledge', '/api/cases/REF-2026-0001/acknowledge')).toBe('/api/cases/:id/acknowledge');
    expect(label('/', '/api/cases')).toBe('/api/cases');
    expect(label('/', '/api/facilities/cmwo45dpi0007lrx03cy27sfg/api-keys')).toBe('/api/facilities/:id/api-keys');
    expect(label('/:keyId', '/api/facilities/cmwo45dpi0007lrx03cy27sfg/api-keys/cmwo45dpi0008lrx03cy27sfh')).toBe('/api/facilities/:id/api-keys/:keyId');
    expect(label('/patients/:patientCode/export', '/api/privacy/patients/PT-8001/export')).toBe('/api/privacy/patients/:patientCode/export');
    expect(label('/fhir/ServiceRequest/:ref', '/api/integrations/v1/fhir/ServiceRequest/REF-2026-0001')).toBe('/api/integrations/v1/fhir/ServiceRequest/:ref');
  });
  it('unmatched paths share one label', () => {
    expect(routeLabel({ originalUrl: '/api/whatever/REF-1' })).toBe('unmatched');
  });
});

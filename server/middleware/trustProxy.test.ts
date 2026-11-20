import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../test/helpers';

const TOKEN = 'diagnostics-token-for-tests-0123456789';
const setToken = (v?: string) => ((env as { METRICS_TOKEN?: string }).METRICS_TOKEN = v);
afterEach(() => setToken(undefined));
afterAll(() => prisma.$disconnect());

const whoami = (app: ReturnType<typeof createApp>, xff?: string, token: string | null = TOKEN) => {
  const r = request(app).get('/diagnostics/client-ip');
  if (token) r.set('Authorization', `Bearer ${token}`);
  if (xff) r.set('X-Forwarded-For', xff);
  return r;
};

describe('which address the app believes the caller has', () => {
  // The caller's real address is 203.0.113.9; one proxy appended it, and the caller also tried to forge 1.2.3.4 up front.
  const chain = '1.2.3.4, 203.0.113.9';

  it('with one trusted proxy, the real address is the LAST entry and a forged one is ignored', async () => {
    setToken(TOKEN);
    expect((await whoami(createApp({ trustProxy: 1 }), chain).expect(200)).body.ip).toBe('203.0.113.9');
  });

  it('with two trusted proxies (e.g. a CDN in front of the load balancer), it reads one entry further back', async () => {
    setToken(TOKEN);
    expect((await whoami(createApp({ trustProxy: 2 }), '203.0.113.9, 198.51.100.7').expect(200)).body.ip).toBe('203.0.113.9');
  });

  it('too LOW a setting makes every visitor look like the proxy; too HIGH lets a visitor forge their address', async () => {
    setToken(TOKEN);
    // Two real proxies, but the app trusts only one: it reports the first proxy instead of the visitor.
    expect((await whoami(createApp({ trustProxy: 1 }), '203.0.113.9, 198.51.100.7').expect(200)).body.ip).toBe('198.51.100.7');
    // One real proxy, but the app trusts two: the visitor's forged first entry is believed.
    expect((await whoami(createApp({ trustProxy: 2 }), chain).expect(200)).body.ip).toBe('1.2.3.4');
  });

  it('with no trusted proxy, the header is ignored entirely', async () => {
    setToken(TOKEN);
    const res = await whoami(createApp({ trustProxy: 0 }), chain).expect(200);
    expect(res.body.ip).not.toBe('1.2.3.4');
    expect(res.body.ip).not.toBe('203.0.113.9');
    expect(res.body.trustProxy).toBe(0);
  });

  it('reports what it saw so an operator can compare it with their own public address', async () => {
    setToken(TOKEN);
    const body = (await whoami(createApp({ trustProxy: 1 }), chain).expect(200)).body;
    expect(body).toMatchObject({ ip: '203.0.113.9', xForwardedFor: chain, trustProxy: 1 });
    expect(body.forwardedChain).toEqual(['203.0.113.9']);
  });

  it('is an operator-only endpoint: absent without a token configured, and needs the exact token', async () => {
    const app = createApp({ trustProxy: 1 });
    expect((await whoami(app)).status).toBe(404); // METRICS_TOKEN unset
    setToken(TOKEN);
    expect((await whoami(app, undefined, null)).status).toBe(401);
    expect((await whoami(app, undefined, 'wrong-token-wrong-token-wrong-1')).status).toBe(401);
    expect((await whoami(app)).headers['cache-control']).toBe('no-store');
  });
});

describe('why it matters: per-IP rate limits follow the address the app believes in', () => {
  it('with the right setting, different visitors have separate budgets', async () => {
    const app = createApp({ trustProxy: 1, leads: { maxPerIp: 2 } });
    const post = (ip: string) => request(app).post('/api/leads').set('X-Forwarded-For', `10.9.9.9, ${ip}`).send({ name: 'X', organization: 'Y', email: 'x@y.org', pathway: 'Cancer Screening', website: 'bot' });
    expect([(await post('203.0.113.1')).status, (await post('203.0.113.1')).status, (await post('203.0.113.1')).status]).toEqual([202, 202, 429]);
    expect((await post('203.0.113.2')).status).toBe(202); // a different visitor is unaffected
  });

  it('with the setting too low (the misconfiguration), visitors behind the same proxy share ONE budget', async () => {
    const app = createApp({ trustProxy: 0, leads: { maxPerIp: 2 } });
    const post = (ip: string) => request(app).post('/api/leads').set('X-Forwarded-For', ip).send({ name: 'X', organization: 'Y', email: 'x@y.org', pathway: 'Cancer Screening', website: 'bot' });
    expect((await post('203.0.113.1')).status).toBe(202);
    expect((await post('203.0.113.2')).status).toBe(202);
    expect((await post('203.0.113.3')).status).toBe(429); // an innocent third visitor is blocked
  });
});

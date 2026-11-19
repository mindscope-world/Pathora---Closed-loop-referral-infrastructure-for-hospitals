import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app';

const app = createApp();

describe('health', () => {
  it('GET /healthz returns 200 and a request id', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /api/healthz returns 200 (the path the Vite proxy uses)', async () => {
    const res = await request(app).get('/api/healthz');
    expect(res.status).toBe(200);
  });

  it('echoes a well-formed inbound request id and rejects malformed ones', async () => {
    const ok = await request(app).get('/healthz').set('X-Request-Id', 'abc12345-test');
    expect(ok.headers['x-request-id']).toBe('abc12345-test');
    const bad = await request(app).get('/healthz').set('X-Request-Id', 'bad id\twith spaces');
    expect(bad.headers['x-request-id']).not.toBe('bad id\twith spaces');
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('errors', () => {
  it('unknown routes return a JSON 404 envelope', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('malformed JSON returns 400 INVALID_JSON', async () => {
    const res = await request(app).post('/api/nope').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('oversized bodies return 413', async () => {
    const res = await request(app).post('/api/nope').send({ blob: 'x'.repeat(200_000) });
    expect(res.status).toBe(413);
  });
});

describe('cors', () => {
  it('allows the configured APP_URL origin', async () => {
    const res = await request(app).get('/healthz').set('Origin', process.env.APP_URL!);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(process.env.APP_URL);
  });

  it('rejects any other origin', async () => {
    const res = await request(app).get('/healthz').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

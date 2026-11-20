import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';

/**
 * The deployment guide tells operators that APP_URL must EXACTLY match the address people use, because a request carrying
 * a different Origin is refused with 403 CORS_DENIED and browsers send Origin when signing in. These tests pin that
 * behaviour so the guide cannot quietly become wrong.
 */
const original = env.APP_URL;
afterEach(() => ((env as { APP_URL: string }).APP_URL = original));
const appFor = (appUrl: string) => {
  (env as { APP_URL: string }).APP_URL = appUrl;
  return createApp(); // the allowed origin is read when the app is created
};
const login = (app: ReturnType<typeof createApp>, origin?: string) => {
  const r = request(app).post('/api/auth/login').send({ email: 'nobody@example.org', password: 'not-a-real-password' });
  return origin ? r.set('Origin', origin) : r;
};

describe('APP_URL and the browser Origin', () => {
  it('a sign-in from the configured address reaches the app (it is then just a wrong password)', async () => {
    const res = await login(appFor('https://pathora.example'), 'https://pathora.example');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('a sign-in from any other address is refused with 403 CORS_DENIED before it reaches the app', async () => {
    const app = appFor('https://pathora.example');
    for (const origin of ['https://other.example', 'http://pathora.example', 'https://www.pathora.example', 'https://pathora.example:8443', 'https://pathora.example.evil.test']) {
      const res = await login(app, origin);
      expect(res.status, origin).toBe(403);
      expect(res.body.error.code, origin).toBe('CORS_DENIED');
    }
  });

  it('www and the bare domain are different addresses; the scheme and the port count too', async () => {
    const app = appFor('https://www.pathora.example');
    expect((await login(app, 'https://www.pathora.example')).status).toBe(401);
    expect((await login(app, 'https://pathora.example')).status).toBe(403);
    expect((await login(appFor('http://localhost:3000'), 'http://localhost:3001')).status).toBe(403);
  });

  it('a trailing slash or path in APP_URL does not matter (only the origin is compared)', async () => {
    expect((await login(appFor('https://pathora.example/'), 'https://pathora.example')).status).toBe(401);
    expect((await login(appFor('https://pathora.example/app'), 'https://pathora.example')).status).toBe(401);
  });

  it('requests with no Origin (curl, health checks, server-to-server) are not affected', async () => {
    const app = appFor('https://pathora.example');
    expect((await login(app)).status).toBe(401);
    expect((await request(app).get('/readyz')).status).toBe(200);
  });

  it('the refusal applies to every route, including the health check, when the Origin is foreign', async () => {
    const res = await request(appFor('https://pathora.example')).get('/api/healthz').set('Origin', 'https://other.example');
    expect(res.status).toBe(403);
  });
});

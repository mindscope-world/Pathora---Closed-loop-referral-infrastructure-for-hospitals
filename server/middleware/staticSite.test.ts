import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { staticSite } from './staticSite';

let dir: string;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pathora-static-'));
  await mkdir(path.join(dir, 'assets'));
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>Pathora</title><div id="root"></div>');
  await writeFile(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  await writeFile(path.join(dir, 'favicon.svg'), '<svg/>');
  await writeFile(path.join(dir, '.secret'), 'do not serve');
  app = createApp({ staticDir: dir });
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const html = (url: string) => request(app).get(url).set('Accept', 'text/html');

describe('serving the built frontend', () => {
  it('serves index.html at the root, uncached', async () => {
    const res = await html('/').expect(200);
    expect(res.text).toContain('<div id="root">');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('falls back to index.html for client-side routes (deep links survive a reload)', async () => {
    for (const url of ['/dashboard', '/dashboard/cases/REF-2026-0001', '/login']) {
      const res = await html(url).expect(200);
      expect(res.text).toContain('<div id="root">');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('caches fingerprinted assets for a year, other files briefly', async () => {
    const asset = await request(app).get('/assets/app-abc123.js').expect(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(asset.headers['content-type']).toContain('javascript');
    expect((await request(app).get('/favicon.svg').expect(200)).headers['cache-control']).toBe('public, max-age=3600');
  });

  it('a missing file is a real 404, never an HTML page standing in for a script', async () => {
    const res = await html('/assets/missing-abc123.js');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('<div id="root">');
    expect((await html('/favicon.ico')).status).toBe(404);
  });

  it('never swallows the API: unknown API routes stay JSON 404s, and real ones still work', async () => {
    const miss = await html('/api/nope').expect(404);
    expect(miss.body.error.code).toBe('NOT_FOUND');
    expect((await request(app).get('/api/healthz').expect(200)).body.status).toBe('ok');
    expect((await request(app).get('/healthz').expect(200)).body.status).toBe('ok');
    expect((await request(app).get('/readyz').expect(200)).body.status).toBe('ready');
  });

  it('only GET/HEAD pages fall back; other methods and non-HTML requests do not', async () => {
    expect((await request(app).post('/dashboard').set('Accept', 'text/html').send({})).status).toBe(404);
    expect((await request(app).get('/dashboard').set('Accept', 'application/json')).status).toBe(404);
  });

  it('does not serve dotfiles or escape the folder', async () => {
    expect((await html('/.secret')).status).not.toBe(200);
    for (const evil of ['/..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd', '/assets/..%2f..%2f.secret', '/assets/../../etc/passwd']) {
      const res = await request(app).get(evil).set('Accept', 'text/html');
      expect(res.text).not.toMatch(/root:|do not serve/);
    }
  });

  it('is off by default (development and tests): no frontend, just the API', async () => {
    const bare = createApp();
    expect((await request(bare).get('/').set('Accept', 'text/html')).status).toBe(404);
    expect((await request(bare).get('/api/healthz')).status).toBe(200);
  });

  it('staticSite returns null when there is no build to serve', () => {
    expect(staticSite(path.join(dir, 'does-not-exist'))).toBeNull();
  });
});

describe('security headers', () => {
  it('sends a strict Content-Security-Policy and the usual hardening headers on every response', async () => {
    for (const res of [await html('/').expect(200), await request(app).get('/api/healthz').expect(200), await request(app).get('/api/nope').expect(404)]) {
      const csp = res.headers['content-security-policy'] as string;
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("connect-src 'self'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['strict-transport-security']).toBeDefined();
    }
  });

  it('allows no script from anywhere but ourselves, and no eval or inline script', async () => {
    const csp = (await html('/').expect(200)).headers['content-security-policy'] as string;
    const script = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'))!;
    expect(script).toBe("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/\*/); // no wildcard sources
  });

  it('permits only the font hosts the page actually uses', async () => {
    const csp = (await html('/').expect(200)).headers['content-security-policy'] as string;
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('https://fonts.gstatic.com');
    expect(csp.match(/https:\/\/[a-z.]+/g)!.sort()).toEqual(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
  });
});

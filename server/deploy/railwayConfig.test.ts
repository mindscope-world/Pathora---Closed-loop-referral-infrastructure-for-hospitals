import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { envSchema } from '../config/env';
import { prisma } from '../test/helpers';

interface RailwayConfig {
  build: { builder: string; dockerfilePath: string };
  deploy: { preDeployCommand: string[]; healthcheckPath: string; numReplicas: number };
}
const cfg = JSON.parse(readFileSync('railway.json', 'utf8')) as RailwayConfig;
const dockerfile = readFileSync('Dockerfile', 'utf8');

afterAll(() => prisma.$disconnect());

describe('railway.json', () => {
  it('builds the Dockerfile, whose LAST stage (the one Railway builds) must be the app', () => {
    expect(cfg.build).toMatchObject({ builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' });
    const stages = [...dockerfile.matchAll(/^FROM .+ AS (\w+)$/gm)].map((m) => m[1]);
    expect(stages.at(-1)).toBe('runtime');
  });

  it('migrates before each release, and the image it runs in can actually do that', () => {
    expect(cfg.deploy.preDeployCommand).toEqual(['npx prisma migrate deploy']);
    const runtime = dockerfile.slice(dockerfile.indexOf('AS runtime'));
    for (const needed of ['prisma.config.ts', 'server/db/schema.prisma', 'server/db/migrations', 'docker-entrypoint.sh']) expect(runtime).toContain(needed);
    expect(dockerfile).toMatch(/npm install --omit=dev --no-save .*prisma@/); // the CLI is present in the production image
  });

  it('health-checks an endpoint the app really serves, that reports database readiness', async () => {
    expect(cfg.deploy.healthcheckPath).toBe('/readyz');
    const res = await request(createApp()).get(cfg.deploy.healthcheckPath).expect(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('keeps one replica while exports are on local disk', () => {
    expect(cfg.deploy.numReplicas).toBe(1);
  });

  it('contains no secrets: variables are set in Railway, never in the repository', () => {
    expect(Object.keys(cfg)).not.toContain('variables');
    expect(JSON.stringify(cfg)).not.toMatch(/SECRET|FIELD_ENCRYPTION_KEY|DATABASE_URL/);
  });

  it('documents a variable set the app accepts in production, including its guard against weak settings', () => {
    // The set in docs/railway-deployment.md, with sample values where a person or Railway fills them in.
    const dockerEnv = Object.fromEntries([...(dockerfile.match(/^ENV (.+)$/gm) ?? [])].flatMap((l) => l.slice(4).split(/\s+/)).map((kv) => kv.split('=') as [string, string]));
    const env: Record<string, string> = {
      ...dockerEnv,
      DATABASE_URL: 'postgresql://postgres:pass@postgres.railway.internal:5432/railway',
      JWT_SECRET: randomBytes(32).toString('base64'),
      COOKIE_SECRET: randomBytes(32).toString('base64'),
      FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      APP_URL: 'https://pathora-production.up.railway.app',
      MESSAGING_PROVIDER: 'mock',
      TRUST_PROXY: '1',
      LOG_LEVEL: 'info',
    };
    expect(env.NODE_ENV).toBe('production');
    const r = envSchema.safeParse(env);
    expect(r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([]);
    expect(r.success && r.data.TRUST_PROXY).toBe(1);
    const required = Object.entries(envSchema.shape).filter(([, s]) => !s.safeParse(undefined).success).map(([k]) => k);
    expect(required.sort()).toEqual(['APP_URL', 'COOKIE_SECRET', 'DATABASE_URL', 'FIELD_ENCRYPTION_KEY', 'JWT_SECRET']);
  });
});

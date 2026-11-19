import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { envSchema } from '../config/env';
import { prisma } from '../test/helpers';

interface EnvVar { key: string; value?: string | number; sync?: boolean; generateValue?: boolean; fromDatabase?: { name: string; property: string } }
interface Blueprint {
  databases: Array<{ name: string; plan: string; region: string; postgresMajorVersion: string }>;
  services: Array<{ type: string; name: string; runtime: string; dockerfilePath: string; region: string; plan: string; numInstances?: number; healthCheckPath: string; preDeployCommand: string; envVars: EnvVar[]; disk?: { mountPath: string } }>;
}
const bp = parse(readFileSync('render.yaml', 'utf8')) as Blueprint;
const dockerfile = readFileSync('Dockerfile', 'utf8');
const web = bp.services.find((s) => s.type === 'web')!;
const db = bp.databases[0];
const envOf = (key: string) => web.envVars.find((e) => e.key === key);

afterAll(() => prisma.$disconnect());

describe('render.yaml', () => {
  it('describes one Docker web service and one Postgres in the same region', () => {
    expect(bp.services).toHaveLength(1);
    expect(web).toMatchObject({ runtime: 'docker', dockerfilePath: './Dockerfile' });
    expect(bp.databases).toHaveLength(1);
    expect(db.region).toBe(web.region); // the database is reached over Render's private network, which is per region
    expect(db.postgresMajorVersion).toBe('16'); // what docker-compose and CI use
  });

  it('builds the image Render will actually build: the LAST stage of the Dockerfile, which must be the app', () => {
    const stages = [...dockerfile.matchAll(/^FROM .+ AS (\w+)$/gm)].map((m) => m[1]);
    expect(stages.at(-1)).toBe('runtime');
  });

  it('uses an always-on paid plan, because background jobs run inside the web process', () => {
    expect(web.plan).not.toBe('free'); // a free service sleeps when idle and would silently stop SLA checks and messages
  });

  it('migrates before each release, and the image it runs in can actually do that', () => {
    expect(web.preDeployCommand).toBe('npx prisma migrate deploy');
    const runtime = dockerfile.slice(dockerfile.indexOf('AS runtime'));
    for (const needed of ['prisma.config.ts', 'server/db/schema.prisma', 'server/db/migrations', 'docker-entrypoint.sh']) expect(runtime).toContain(needed);
    expect(dockerfile).toMatch(/npm install --omit=dev --no-save .*prisma@/); // the CLI is present in the production image
  });

  it('health-checks an endpoint the app really serves, that reports database readiness', async () => {
    expect(web.healthCheckPath).toBe('/readyz');
    const res = await request(createApp()).get(web.healthCheckPath).expect(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('never contains a secret: secrets are generated, prompted for, or taken from the database', () => {
    for (const secret of ['JWT_SECRET', 'COOKIE_SECRET', 'FIELD_ENCRYPTION_KEY', 'APP_URL', 'MESSAGING_PROVIDER', 'DATABASE_URL', 'METRICS_TOKEN', 'SMTP_URL', 'AT_API_KEY']) {
      const e = envOf(secret);
      if (!e) continue;
      expect(e.value, `${secret} must not have a literal value in the repository`).toBeUndefined();
    }
    // The encryption key and the public URL must be chosen by a person, never invented for them.
    expect(envOf('FIELD_ENCRYPTION_KEY')).toMatchObject({ sync: false });
    expect(envOf('APP_URL')).toMatchObject({ sync: false });
    // A person must consciously choose whether messages are really sent (the mock provider sends nothing).
    expect(envOf('MESSAGING_PROVIDER')).toMatchObject({ sync: false });
  });

  it('only sets variables the app actually reads (no typos), and sets every one it requires', () => {
    const known = new Set(Object.keys(envSchema.shape));
    for (const e of web.envVars) expect(known.has(e.key), `${e.key} is not an environment variable the app reads`).toBe(true);
    const required = Object.entries(envSchema.shape).filter(([, schema]) => !schema.safeParse(undefined).success).map(([k]) => k);
    expect(required.sort()).toEqual(['APP_URL', 'COOKIE_SECRET', 'DATABASE_URL', 'FIELD_ENCRYPTION_KEY', 'JWT_SECRET']);
    for (const k of required) expect(envOf(k), `${k} is required by the app but not set in the blueprint`).toBeDefined();
  });

  it('produces a configuration the app accepts in production, including its guard against weak settings', () => {
    // Build the production environment exactly as Render would, with sample values where a person fills them in.
    const dockerEnv = Object.fromEntries([...(dockerfile.match(/^ENV (.+)$/gm) ?? [])].flatMap((l) => l.slice(4).split(/\s+/)).map((kv) => kv.split('=') as [string, string]));
    const env: Record<string, string> = { ...dockerEnv };
    for (const e of web.envVars) {
      if (e.fromDatabase) env[e.key] = 'postgresql://user:pass@dpg-abc123:5432/pathora';
      else if (e.generateValue) env[e.key] = randomBytes(32).toString('base64'); // "a base64-encoded 256-bit value" per Render's schema
      else if (e.sync === false) env[e.key] = { APP_URL: 'https://pathora.onrender.com', FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'), MESSAGING_PROVIDER: 'mock' }[e.key] ?? 'x';
      else env[e.key] = String(e.value);
    }
    expect(env.NODE_ENV).toBe('production');
    const r = envSchema.safeParse(env);
    expect(r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([]);
    expect(r.success && r.data.TRUST_PROXY).toBe(1);
  });

  it('if a persistent disk is ever enabled, exports are pointed at it and the service stays on one instance', () => {
    if (!web.disk) return;
    expect(envOf('EXPORT_DIR')?.value).toMatch(new RegExp(`^${web.disk.mountPath}`));
    expect(web.numInstances ?? 1).toBe(1);
  });

  it('keeps one instance while exports are on local disk', () => {
    expect(web.numInstances).toBe(1);
  });
});

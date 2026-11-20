import { describe, expect, it } from 'vitest';
import { envSchema, parseTrustProxy, withSecretFiles } from './env';

const GOOD = {
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db:5432/pathora', APP_URL: 'https://app.pathora.test',
  JWT_SECRET: 'a'.repeat(40), COOKIE_SECRET: 'b'.repeat(40), FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};
const issues = (over: Record<string, unknown>) => {
  const r = envSchema.safeParse({ ...GOOD, ...over });
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('production configuration guard', () => {
  it('accepts a real production configuration', () => {
    expect(issues({})).toEqual([]);
  });

  it.each(['JWT_SECRET', 'COOKIE_SECRET'])('refuses the example placeholder for %s in production', (key) => {
    expect(issues({ [key]: 'replace-me-with-at-least-32-random-characters' }).join()).toContain('placeholder');
  });
  it('refuses a placeholder field-encryption key in production', () => {
    // A 32-byte key that still looks like the example text.
    expect(issues({ FIELD_ENCRYPTION_KEY: Buffer.from('replace-me-padded-to-32-bytes!!!').toString('base64') }).join()).toContain('placeholder');
  });
  it('refuses reusing one secret for both JWT and cookies, and a non-https APP_URL', () => {
    expect(issues({ COOKIE_SECRET: GOOD.JWT_SECRET }).join()).toContain('must differ');
    expect(issues({ APP_URL: 'http://app.pathora.test' }).join()).toContain('https');
  });
  it('does not apply those rules in development or test', () => {
    expect(issues({ NODE_ENV: 'development', APP_URL: 'http://localhost:3000', JWT_SECRET: 'replace-me-with-at-least-32-random-characters', COOKIE_SECRET: 'replace-me-with-at-least-32-random-characters' })).toEqual([]);
  });
  it('enforces secret strength everywhere: short secrets and a short metrics token fail', () => {
    expect(issues({ NODE_ENV: 'development', JWT_SECRET: 'short' }).join()).toContain('JWT_SECRET');
    expect(issues({ METRICS_TOKEN: 'too-short' }).join()).toContain('METRICS_TOKEN');
  });
});

describe('secret files (for secret managers that mount files)', () => {
  const files: Record<string, string> = { '/run/secrets/jwt': 'from-file-secret-value\n', '/run/secrets/db': '  postgresql://x  ' };
  const read = (p: string) => {
    if (!(p in files)) throw new Error('ENOENT');
    return files[p];
  };

  it('fills NAME from NAME_FILE, trimming whitespace', () => {
    const out = withSecretFiles({ JWT_SECRET_FILE: '/run/secrets/jwt', DATABASE_URL_FILE: '/run/secrets/db' }, read);
    expect(out.JWT_SECRET).toBe('from-file-secret-value');
    expect(out.DATABASE_URL).toBe('postgresql://x');
  });
  it('never overrides a value that is already set', () => {
    expect(withSecretFiles({ JWT_SECRET: 'explicit', JWT_SECRET_FILE: '/run/secrets/jwt' }, read).JWT_SECRET).toBe('explicit');
  });
  it('leaves unrelated variables alone and does not mutate its input', () => {
    const input = { PORT: '4000', JWT_SECRET_FILE: '/run/secrets/jwt' };
    const out = withSecretFiles(input, read);
    expect(out.PORT).toBe('4000');
    expect(input).not.toHaveProperty('JWT_SECRET');
  });
});

describe('TRUST_PROXY (how many proxies sit in front of the app)', () => {
  it('defaults to one proxy hop', () => {
    expect(envSchema.parse(GOOD).TRUST_PROXY).toBe(1);
  });

  it.each([
    ['1', 1], ['2', 2], [' 3 ', 3], ['0', 0], ['false', 0], ['FALSE', 0], ['off', 0],
    ['loopback', 'loopback'], ['10.0.0.0/8', '10.0.0.0/8'], ['10.0.0.1', '10.0.0.1'], ['loopback,,', 'loopback'], ['::1', '::1'], ['fd00::/8', 'fd00::/8'], ['loopback,  10.0.0.0/8 ,2001:db8::/32', 'loopback, 10.0.0.0/8, 2001:db8::/32'],
  ])('accepts %j', (raw, want) => {
    expect(parseTrustProxy(raw)).toBe(want);
    expect(envSchema.parse({ ...GOOD, TRUST_PROXY: raw }).TRUST_PROXY).toBe(want);
  });

  it.each(['true', 'TRUE', 'on', 'yes'])('refuses %j: trusting any client-supplied address lets visitors forge theirs', (raw) => {
    expect(() => parseTrustProxy(raw)).toThrow(/forge/);
    expect(issues({ TRUST_PROXY: raw }).join()).toContain('TRUST_PROXY');
  });

  it.each(['-1', '11', '1.5', '', 'abc', 'one', '10.0.0.0/8; drop table', '*', 'http://x', '10.0.0.0/33', '::1/129', '10.0.0.0/8/8', '10.0.0.256', 'dead:beef'])('refuses %j', (raw) => {
    expect(() => parseTrustProxy(raw)).toThrow();
  });
});

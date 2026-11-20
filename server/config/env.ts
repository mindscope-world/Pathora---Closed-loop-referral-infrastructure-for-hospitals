import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { z } from 'zod';

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, {
    message: 'must be a base64-encoded 32-byte key (generate: openssl rand -base64 32)',
  });

/**
 * How many reverse proxies sit in front of the app, so the client's real address (used by every per-IP rate limit) is
 * read from the right place in X-Forwarded-For. Get this wrong and either all visitors share one address (limits trip for
 * everyone) or a visitor can forge their address (limits are bypassed). So the unsafe value `true` ("trust anyone") is refused.
 *
 *   "1"            one proxy hop (the default)         "2"  two hops          "0" / "false"  no proxy
 *   "10.0.0.0/8, loopback"   trust these addresses/ranges instead of counting hops
 */
export function parseTrustProxy(raw: string): number | string {
  const v = raw.trim();
  if (/^(false|off|no)$/i.test(v)) return 0;
  if (/^\d+$/.test(v)) {
    const hops = Number(v);
    if (hops > 10) throw new Error('is not plausible: more than 10 proxy hops');
    return hops;
  }
  if (/^(true|on|yes)$/i.test(v)) throw new Error('"true" would trust any client-supplied address and let visitors forge theirs; use a hop count or a list of proxy addresses');
  const parts = v.split(',').map((p) => p.trim()).filter(Boolean);
  const validEntry = (p: string) => {
    if (/^(loopback|linklocal|uniquelocal)$/i.test(p)) return true;
    const [addr, prefix, ...rest] = p.split('/');
    const family = isIP(addr); // a real parse: "abc" and "1.5" are not addresses
    if (family === 0 || rest.length > 0) return false;
    if (prefix === undefined) return true;
    return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
  };
  const ok = parts.length > 0 && parts.every(validEntry);
  if (!ok) throw new Error('must be a number of proxy hops, or a comma-separated list of proxy addresses/ranges (e.g. "10.0.0.0/8, loopback")');
  return parts.join(', ');
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  // Interface to listen on. Unset = Node's default (all interfaces, IPv6 dual-stack). Set 0.0.0.0 for hosts whose proxy
  // cannot reach a dual-stack socket.
  HOST: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url().startsWith('postgres'),
  APP_URL: z.string().url(),

  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  COOKIE_SECRET: z.string().min(32, 'must be at least 32 characters'),
  FIELD_ENCRYPTION_KEY: base64Key32,

  // Where generated export files are kept (local disk; swap for object storage in production).
  EXPORT_DIR: z.string().min(1).default('.data/exports'),

  // Outgoing email (team invitations). Without SMTP_URL no email is sent and the inviter shares the link.
  SMTP_URL: z.string().url().optional(),
  MAIL_FROM: z.string().min(3).default('Pathora <no-reply@pathora.example>'),

  // Where walkthrough requests from the public site are emailed (needs SMTP_URL). They are always stored regardless.
  LEADS_NOTIFY_EMAIL: z.string().email().optional(),

  // Messaging provider (used from Phase 7). 'mock' needs no credentials.
  MESSAGING_PROVIDER: z.enum(['mock', 'africastalking']).default('mock'),
  AT_USERNAME: z.string().optional(),
  AT_API_KEY: z.string().optional(),
  AT_SENDER_ID: z.string().optional(),
  /** Override for the sandbox (https://api.sandbox.africastalking.com). */
  AT_BASE_URL: z.string().url().optional(),
  /** Shared secret the provider puts on webhook URLs (?secret=…). Webhooks are disabled without it. */
  MESSAGING_WEBHOOK_SECRET: z.string().min(24, 'must be at least 24 characters').optional(),

  // Reverse proxies in front of the app (see parseTrustProxy). Verify with /diagnostics/client-ip after deploying.
  TRUST_PROXY: z
    .string()
    .default('1')
    .transform((v, ctx) => {
      try {
        return parseTrustProxy(v);
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: (e as Error).message });
        return z.NEVER;
      }
    }),

  // Production: serve the built frontend from this folder (single deployable). Default: ./dist when NODE_ENV=production.
  STATIC_DIR: z.string().min(1).optional(),
  // Enables GET /metrics (Prometheus format) for a scraper that presents this bearer token. Unset = endpoint disabled.
  METRICS_TOKEN: z.string().min(24, 'must be at least 24 characters').optional(),

  // Optional server-side Gemini key (Phase 9).
  GEMINI_API_KEY: z.string().optional(),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production') {
    // Never run production on the example values or in the clear.
    for (const key of ['JWT_SECRET', 'COOKIE_SECRET', 'FIELD_ENCRYPTION_KEY'] as const) {
      // The encryption key is base64: look at what it decodes to, since the encoded text would hide a placeholder.
      const text = key === 'FIELD_ENCRYPTION_KEY' ? Buffer.from(env[key], 'base64').toString('latin1') : env[key];
      if (/replace-me|changeme|example|password/i.test(text)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'still has a placeholder value; generate a real secret' });
      }
    }
    if (env.JWT_SECRET === env.COOKIE_SECRET) ctx.addIssue({ code: 'custom', path: ['COOKIE_SECRET'], message: 'must differ from JWT_SECRET' });
    if (!env.APP_URL.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'must be https in production (cookies and HSTS depend on it)' });
  }
  if (env.MESSAGING_PROVIDER === 'africastalking') {
    for (const key of ['AT_USERNAME', 'AT_API_KEY', 'MESSAGING_WEBHOOK_SECRET'] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: `required when MESSAGING_PROVIDER=africastalking` });
      }
    }
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * Secret managers (Cloud Run, Kubernetes, Docker secrets) mount secrets as files. For any `NAME_FILE=/path`, the file's
 * contents become `NAME` (unless NAME is already set), so secrets never have to sit in the process environment or an image.
 */
export function withSecretFiles(source: NodeJS.ProcessEnv, read: (path: string) => string = (p) => readFileSync(p, 'utf8')): NodeJS.ProcessEnv {
  const out = { ...source };
  for (const [key, path] of Object.entries(source)) {
    if (!key.endsWith('_FILE') || !path) continue;
    const name = key.slice(0, -5);
    if (out[name]) continue;
    try {
      out[name] = read(path).trim();
    } catch {
      console.error(`Could not read the secret file for ${name} (${key}).`);
      process.exit(1);
    }
  }
  return out;
}

function load(): Env {
  const parsed = envSchema.safeParse(withSecretFiles(process.env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    // Deliberately avoid printing values: they may be secrets.
    console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = load();
export const isProd = env.NODE_ENV === 'production';

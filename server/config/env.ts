import 'dotenv/config';
import { z } from 'zod';

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, {
    message: 'must be a base64-encoded 32-byte key (generate: openssl rand -base64 32)',
  });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
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

  // Messaging provider (used from Phase 7). 'mock' needs no credentials.
  MESSAGING_PROVIDER: z.enum(['mock', 'africastalking']).default('mock'),
  AT_USERNAME: z.string().optional(),
  AT_API_KEY: z.string().optional(),
  AT_SENDER_ID: z.string().optional(),
  /** Override for the sandbox (https://api.sandbox.africastalking.com). */
  AT_BASE_URL: z.string().url().optional(),
  /** Shared secret the provider puts on webhook URLs (?secret=…). Webhooks are disabled without it. */
  MESSAGING_WEBHOOK_SECRET: z.string().min(24, 'must be at least 24 characters').optional(),

  // Optional server-side Gemini key (Phase 9).
  GEMINI_API_KEY: z.string().optional(),
}).superRefine((env, ctx) => {
  if (env.MESSAGING_PROVIDER === 'africastalking') {
    for (const key of ['AT_USERNAME', 'AT_API_KEY', 'MESSAGING_WEBHOOK_SECRET'] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: `required when MESSAGING_PROVIDER=africastalking` });
      }
    }
  }
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
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

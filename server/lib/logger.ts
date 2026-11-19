import pino, { type DestinationStream } from 'pino';
import { env, isProd } from '../config/env';

const PHONE = /\(?\+?\d[\d\s().-]{7,}\d/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Error messages come from libraries and providers and can echo what we sent them (a number, an address). */
export const scrubPii = (text: string): string => text.replace(EMAIL, '[email]').replace(PHONE, '[number]');

/** Fields that must never reach a log line, at the top level and one level down (pino's `*` matches a single key). */
const SECRET_FIELDS = ['password', 'passwordHash', 'token', 'apiKey', 'signingSecret', 'patientName', 'patientPhone', 'phone', 'nameEnc', 'phoneEnc'];
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.headers["x-pathora-signature"]',
  'req.headers["idempotency-key"]',
  'req.body',
  ...SECRET_FIELDS,
  ...SECRET_FIELDS.map((f) => `*.${f}`),
];

const options = (level: string): pino.LoggerOptions => ({
  level,
  serializers: {
    err: (err: unknown) => {
      const e = pino.stdSerializers.err(err as Error);
      return { ...e, message: scrubPii(String(e.message ?? '')), stack: e.stack ? scrubPii(e.stack) : e.stack };
    },
  },
  // Never log credentials or patient data.
  redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
});

/** `stream` lets a test capture the output; production writes JSON lines to stdout for the platform's log collector. */
export function createLogger(stream?: DestinationStream, level: string = env.LOG_LEVEL) {
  if (stream) return pino(options(level), stream);
  return pino({
    ...options(level),
    ...(isProd || env.NODE_ENV === 'test' ? {} : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
  });
}

export const logger = createLogger();

import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../db/client';

let counter = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}.${Date.now()}.${++counter}@test.example`;

export const STRONG_PASSWORD = 'correct horse battery staple';

/** App with generous per-IP caps so only the behaviour under test can trigger limits. */
/**
 * Background export generation is off in tests (the kick does nothing); tests that need an export
 * generated call `processPending()` themselves, which keeps them deterministic.
 */
export const makeApp = () =>
  createApp({ auth: { loginMaxPerIp: 10_000, signupMaxPerIp: 10_000 }, invites: { maxPerIp: 10_000 }, messages: { kick: () => undefined }, exports: { kick: () => undefined } });

export function signupBody(over: Record<string, unknown> = {}) {
  return {
    fullName: 'Test Manager',
    organization: `Test Org ${Date.now()}-${++counter}`,
    email: uniqueEmail('mgr'),
    password: STRONG_PASSWORD,
    pathway: 'Cancer Screening',
    ...over,
  };
}

export function cookieFrom(res: request.Response, name = 'pathora_rt'): string | undefined {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));
  return raw?.split(';')[0].slice(name.length + 1);
}

export const rawSetCookie = (res: request.Response, name = 'pathora_rt') =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));

export { prisma };

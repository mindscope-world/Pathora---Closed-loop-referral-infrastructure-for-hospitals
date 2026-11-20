import { hash, verify } from 'argon2';

/**
 * argon2id. Production uses the library defaults (memory-hard, 64 MiB). Under `NODE_ENV=test` only,
 * a minimal cost is used so the test suite is not dominated (and made flaky) by hashing. Every stored
 * hash records its own parameters, so verification is unaffected, and this cannot be enabled in production.
 */
const OPTIONS = process.env.NODE_ENV === 'test' ? ({ memoryCost: 1024, timeCost: 1, parallelism: 1 } as const) : undefined;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false; // malformed hash
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same CPU as a real verification. Called when the account does not exist (or is
 * inactive) so response time does not reveal which emails are registered.
 */
export async function verifyAgainstDummy(plain: string): Promise<void> {
  dummyHash ??= hash('pathora-timing-equaliser', OPTIONS);
  await verify(await dummyHash, plain).catch(() => false);
}

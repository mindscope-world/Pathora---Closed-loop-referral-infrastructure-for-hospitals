import { hash, verify } from 'argon2';

/** argon2id with the library defaults (memory-hard; tuned by the `argon2` package). */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
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
  dummyHash ??= hash('pathora-timing-equaliser');
  await verify(await dummyHash, plain).catch(() => false);
}

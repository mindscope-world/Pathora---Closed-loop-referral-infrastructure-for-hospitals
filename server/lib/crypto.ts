import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Column-level encryption for patient identifiers (name, phone).
 *
 * Envelope: [ keyVersion(1) | iv(12) | authTag(16) | ciphertext ]  — AES-256-GCM.
 * `aad` (additional authenticated data) binds a ciphertext to its context (e.g. the org), so a blob
 * copied into another row/tenant fails authentication instead of decrypting.
 *
 * Key rotation: bump KEY_VERSION, keep old keys available keyed by version, and re-encrypt lazily.
 * Only version 1 exists today.
 */
const KEY_VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
export const ENVELOPE_HEADER_LEN = 1 + IV_LEN + TAG_LEN;

function loadKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  const key = raw ? Buffer.from(raw, 'base64') : undefined;
  if (!key || key.length !== 32) {
    throw new Error('FIELD_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

export function encryptField(plaintext: string, aad: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  // Plain Uint8Array (not Buffer) is what Prisma's Bytes columns accept.
  return new Uint8Array(Buffer.concat([Buffer.from([KEY_VERSION]), iv, cipher.getAuthTag(), ct]));
}

export function decryptField(envelope: Uint8Array, aad: string): string {
  const buf = Buffer.from(envelope);
  if (buf.length < ENVELOPE_HEADER_LEN) throw new Error('Ciphertext envelope too short');
  const version = buf[0];
  if (version !== KEY_VERSION) throw new Error(`Unsupported key version ${version}`);
  const iv = buf.subarray(1, 1 + IV_LEN);
  const tag = buf.subarray(1 + IV_LEN, ENVELOPE_HEADER_LEN);
  const ct = buf.subarray(ENVELOPE_HEADER_LEN);
  const decipher = createDecipheriv('aes-256-gcm', loadKey(), iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** AAD conventions, kept in one place so encrypt/decrypt call sites cannot drift. */
export const aad = {
  patientName: (orgId: string) => `Patient.name:${orgId}`,
  patientPhone: (orgId: string) => `Patient.phone:${orgId}`,
  apiKeySigning: (orgId: string, keyId: string) => `FacilityApiKey.signing:${orgId}:${keyId}`,
};

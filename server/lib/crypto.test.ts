import { describe, expect, it } from 'vitest';
import { aad, decryptField, encryptField, ENVELOPE_HEADER_LEN } from './crypto';

describe('field encryption', () => {
  it('round-trips unicode text', () => {
    const text = 'Jane Wambui — Wanjiru 🌍';
    expect(decryptField(encryptField(text, aad.patientName('org1')), aad.patientName('org1'))).toBe(text);
  });

  it('uses a fresh IV each time (same plaintext, different ciphertext)', () => {
    const a = encryptField('same', 'ctx');
    const b = encryptField('same', 'ctx');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('does not contain the plaintext', () => {
    const env = Buffer.from(encryptField('Jane Wambui', 'ctx'));
    expect(env.includes(Buffer.from('Jane'))).toBe(false);
  });

  it('rejects a ciphertext moved to another context (e.g. another tenant)', () => {
    const env = encryptField('Jane', aad.patientName('orgA'));
    expect(() => decryptField(env, aad.patientName('orgB'))).toThrow();
  });

  it('rejects tampered ciphertext', () => {
    const env = Buffer.from(encryptField('Jane Wambui', 'ctx'));
    env[env.length - 1] ^= 0x01;
    expect(() => decryptField(env, 'ctx')).toThrow();
  });

  it('rejects truncated envelopes and unknown key versions', () => {
    expect(() => decryptField(new Uint8Array(ENVELOPE_HEADER_LEN - 1), 'ctx')).toThrow(/too short/);
    const env = Buffer.from(encryptField('x', 'ctx'));
    env[0] = 9;
    expect(() => decryptField(env, 'ctx')).toThrow(/key version/);
  });
});

import { describe, expect, it } from 'vitest';
import { maskPhone, normalizePhone, phoneHash } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['0712 345 678', '+254712345678'],
    ['0712345678', '+254712345678'],
    ['0112345678', '+254112345678'],
    ['254712345678', '+254712345678'],
    ['+254 712-345-678', '+254712345678'],
    ['(0712) 345.678', '+254712345678'],
    ['712345678', '+254712345678'],
    ['112345678', '+254112345678'],
    ['00254712345678', '+254712345678'],
    ['  +254712345678  ', '+254712345678'],
    ['+447911123456', '+447911123456'],
    ['+12025550123', '+12025550123'],
  ])('writes %j as %s', (raw, expected) => expect(normalizePhone(raw)).toBe(expected));

  it.each([
    '', '   ', 'abc', '0712 345', '07123456789', '+', '+254', '+25471234567', '+2547123456789',
    '0202345678',           // Nairobi landline: cannot receive an SMS
    '+254202345678',        // landline in international form
    '0812345678',           // not a mobile prefix
    '+0712345678', '++254712345678', '0712-345-67a', '1234567', '+1234567',
  ])('rejects %j', (raw) => expect(normalizePhone(raw)).toBeNull());

  it('is idempotent: normalising a normalised number changes nothing', () => {
    const n = normalizePhone('0712345678')!;
    expect(normalizePhone(n)).toBe(n);
  });

  it('every way of writing one number yields the same hash', () => {
    const forms = ['0712345678', '+254712345678', '254 712 345 678', '712345678'].map((f) => phoneHash(normalizePhone(f)!));
    expect(new Set(forms).size).toBe(1);
  });
});

describe('phoneHash', () => {
  it('is a stable 64-char hex digest that reveals nothing of the number', () => {
    const h = phoneHash('+254712345678');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(phoneHash('+254712345678'));
    expect(h).not.toContain('254712345678');
  });
  it('differs for different numbers', () => {
    expect(phoneHash('+254712345678')).not.toBe(phoneHash('+254712345679'));
  });
});

describe('maskPhone', () => {
  it('shows only the country prefix and the last three digits', () => {
    expect(maskPhone('+254712345678')).toBe('+254••••••678');
    expect(maskPhone('+254712345678')).not.toContain('7123456');
  });
});

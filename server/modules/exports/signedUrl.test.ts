import { describe, expect, it } from 'vitest';
import { DOWNLOAD_LINK_TTL_SECONDS, redactToken, signDownloadToken, verifyDownloadToken } from './signedUrl';

const NOW = Date.parse('2026-11-19T12:00:00Z');

describe('download tokens', () => {
  it('round-trips for the right export and returns its organisation', () => {
    const t = signDownloadToken('job1', 'orgA', NOW);
    expect(verifyDownloadToken(t, 'job1', NOW + 1000)).toEqual({ orgId: 'orgA' });
  });

  it('is bound to one export', () => {
    expect(verifyDownloadToken(signDownloadToken('job1', 'orgA', NOW), 'job2', NOW)).toBeNull();
  });

  it('expires after the TTL (and not a second before)', () => {
    const t = signDownloadToken('job1', 'orgA', NOW);
    expect(verifyDownloadToken(t, 'job1', NOW + (DOWNLOAD_LINK_TTL_SECONDS - 1) * 1000)).not.toBeNull();
    expect(verifyDownloadToken(t, 'job1', NOW + (DOWNLOAD_LINK_TTL_SECONDS + 1) * 1000)).toBeNull();
  });

  it('rejects any tampering with the payload or signature', () => {
    const t = signDownloadToken('job1', 'orgA', NOW);
    const [body, sig] = t.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ j: 'job1', o: 'orgB', e: 9_999_999_999 })).toString('base64url');
    expect(verifyDownloadToken(`${forgedBody}.${sig}`, 'job1', NOW)).toBeNull(); // swap org, keep signature
    expect(verifyDownloadToken(`${body}.${sig.slice(0, -2)}AA`, 'job1', NOW)).toBeNull(); // corrupt signature
    expect(verifyDownloadToken(`${body}.`, 'job1', NOW)).toBeNull();
    expect(verifyDownloadToken(body, 'job1', NOW)).toBeNull();
    expect(verifyDownloadToken(`${body}.${sig}.extra`, 'job1', NOW)).toBeNull();
  });

  it.each(['', 'garbage', '.', '..', 'a.b', 'e30.e30', 'x'.repeat(5000)])('rejects malformed token %j', (t) => {
    expect(verifyDownloadToken(t, 'job1', NOW)).toBeNull();
  });

  it('is not interchangeable with a login (JWT-style) token', () => {
    // a JWT has three dot-separated parts and a different key derivation
    expect(verifyDownloadToken('aaa.bbb.ccc', 'job1', NOW)).toBeNull();
  });
});

describe('redactToken', () => {
  it('hides the token wherever it sits in the query string', () => {
    expect(redactToken('/api/exports/abc/download?token=SECRET.SIG')).toBe('/api/exports/abc/download?token=[redacted]');
    expect(redactToken('/x?a=1&token=SECRET&b=2')).toBe('/x?a=1&token=[redacted]&b=2');
    expect(redactToken('/x?token=A&token=B')).toBe('/x?token=[redacted]&token=[redacted]');
  });
  it('leaves other URLs alone', () => {
    expect(redactToken('/api/cases?limit=5')).toBe('/api/cases?limit=5');
  });
});

import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, scrubPii } from './logger';

function capture() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({ write(chunk, _e, cb) { lines.push(JSON.parse(chunk.toString())); cb(); } });
  return { lines, log: createLogger(stream, 'info') };
}

describe('log hygiene', () => {
  it('redacts credentials and patient fields at the top level and one level down', () => {
    const { lines, log } = capture();
    log.info({
      password: 'hunter2', apiKey: 'pk_x.y', signingSecret: 'whsec_z', patientName: 'Wanjiru Kamau', patientPhone: '0712345678',
      user: { token: 't0k3n', passwordHash: 'hash', phone: '0722000111', nameEnc: 'bytes' }, ok: 'visible',
    }, 'msg');
    const out = JSON.stringify(lines[0]);
    for (const secret of ['hunter2', 'pk_x.y', 'whsec_z', 'Wanjiru', '0712345678', 't0k3n', '0722000111', 'hash"', 'bytes']) expect(out).not.toContain(secret);
    expect(lines[0].ok).toBe('visible');
    expect(lines[0].password).toBe('[redacted]');
  });

  it('redacts request headers and bodies that carry secrets', () => {
    const { lines, log } = capture();
    log.info({ req: { headers: { authorization: 'Bearer abc', cookie: 'c=1', 'x-pathora-signature': 't=1,v1=ff', 'idempotency-key': 'key-12345678', 'user-agent': 'curl' }, body: { patientName: 'Secret Person' } } }, 'req');
    const out = JSON.stringify(lines[0]);
    for (const secret of ['Bearer abc', 'c=1', 'v1=ff', 'key-12345678', 'Secret Person']) expect(out).not.toContain(secret);
    expect(out).toContain('curl'); // harmless context is kept
  });

  it('scrubs phone numbers and emails out of error messages and stacks', () => {
    expect(scrubPii('socket hang up to +254711000000 for jane.doe@clinic.org')).toBe('socket hang up to [number] for [email]');
    expect(scrubPii('call 0712 345 678 or (020) 555-0100')).toBe('call [number] or [number]');
    expect(scrubPii('request 3f2a took 1500ms')).toBe('request 3f2a took 1500ms'); // ordinary numbers survive
    const { lines, log } = capture();
    log.error({ err: new Error('provider rejected +254711000000 (patient@example.org)') }, 'send failed');
    const out = JSON.stringify(lines[0]);
    expect(out).not.toContain('254711000000');
    expect(out).not.toContain('patient@example.org');
    expect(out).toContain('provider rejected [number]');
    expect((lines[0].err as { type: string }).type).toBe('Error'); // still a useful error record
  });
});

import { describe, expect, it, vi } from 'vitest';
import { AfricasTalkingProvider } from './africastalking';
import { MockProvider } from './mock';
import type { OutboundMessage } from './provider';

const msg: OutboundMessage = { to: '+254712345678', text: 'Hello from the care team', channel: 'SMS', reference: 'log1' };
const reply = (recipient: object | null, status = 200) =>
  new Response(JSON.stringify({ SMSMessageData: { Message: 'Sent to 1/1', Recipients: recipient ? [recipient] : [] } }), { status, headers: { 'content-type': 'application/json' } });

function provider(fetchImpl: typeof fetch, extra: object = {}) {
  return new AfricasTalkingProvider({ username: 'sandbox', apiKey: 'SECRET-KEY-123', senderId: 'PATHORA', baseUrl: 'https://api.sandbox.africastalking.com', fetchImpl, ...extra });
}

describe('AfricasTalkingProvider: request', () => {
  it('posts a form to the messaging endpoint with the API key header', async () => {
    const f = vi.fn().mockResolvedValue(reply({ statusCode: 101, messageId: 'ATXid_1', number: '+254712345678' }));
    await provider(f as never).send(msg);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.sandbox.africastalking.com/version1/messaging');
    expect(init.method).toBe('POST');
    const h = new Headers(init.headers);
    expect(h.get('apikey')).toBe('SECRET-KEY-123');
    expect(h.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(h.get('accept')).toBe('application/json');
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(Object.fromEntries(body)).toEqual({ username: 'sandbox', to: '+254712345678', message: 'Hello from the care team', from: 'PATHORA' });
  });

  it('omits the sender id when none is configured, and defaults to the production host', async () => {
    const f = vi.fn().mockResolvedValue(reply({ statusCode: 101, messageId: 'x' }));
    await new AfricasTalkingProvider({ username: 'u', apiKey: 'k', fetchImpl: f as never }).send(msg);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.africastalking.com/version1/messaging');
    expect(new URLSearchParams(init.body as URLSearchParams).has('from')).toBe(false);
  });
});

describe('AfricasTalkingProvider: outcomes', () => {
  const send = async (res: Response | Error) => provider((async () => { if (res instanceof Error) throw res; return res; }) as never).send(msg);

  it.each([100, 101, 102])('status code %i is accepted and returns the provider message id', async (statusCode) => {
    expect(await send(reply({ statusCode, messageId: `ATXid_${statusCode}` }))).toEqual({ ok: true, providerMessageId: `ATXid_${statusCode}` });
  });

  it.each([
    [401, true], [405, true], [407, true], [500, true], [501, true],
    [402, false], [403, false], [404, false], [406, false], [502, false],
  ])('per-recipient code %i is %s to retry', async (statusCode, transient) => {
    const r = await send(reply({ statusCode, messageId: 'ignored' }));
    expect(r).toMatchObject({ ok: false, transient });
  });

  it('treats an unknown code as permanent, with a generic reason', async () => {
    expect(await send(reply({ statusCode: 999 }))).toMatchObject({ ok: false, transient: false, reason: expect.any(String) });
  });

  it('treats no recipient entry, or an accepted code without a message id, as a transient failure (not as sent)', async () => {
    expect(await send(reply(null))).toMatchObject({ ok: false, transient: true });
    expect(await send(reply({ statusCode: 101 }))).toMatchObject({ ok: false, transient: true });
  });

  it('classifies HTTP and network problems', async () => {
    expect(await send(new Response('', { status: 500 }))).toMatchObject({ ok: false, transient: true });
    expect(await send(new Response('', { status: 503 }))).toMatchObject({ ok: false, transient: true });
    expect(await send(new Response('', { status: 429 }))).toMatchObject({ ok: false, transient: true });
    expect(await send(new Response('', { status: 401 }))).toMatchObject({ ok: false, transient: false, reason: expect.stringMatching(/credentials/) });
    expect(await send(new Response('', { status: 400 }))).toMatchObject({ ok: false, transient: false });
    expect(await send(new TypeError('fetch failed'))).toMatchObject({ ok: false, transient: true });
    expect(await send(new Response('<html>oops</html>', { status: 200 }))).toMatchObject({ ok: false, transient: true }); // unreadable body
  });

  it('times out a hung request instead of waiting forever, as a transient failure', async () => {
    const hung = ((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as never;
    const r = await provider(hung, { timeoutMs: 20 }).send(msg);
    expect(r).toMatchObject({ ok: false, transient: true });
  });

  it('only handles SMS: other channels are refused as permanent, without calling the provider', async () => {
    const f = vi.fn();
    const p = provider(f as never);
    expect(p.supports('SMS')).toBe(true);
    expect(p.supports('WHATSAPP')).toBe(false);
    expect(await p.send({ ...msg, channel: 'WHATSAPP' })).toMatchObject({ ok: false, transient: false });
    expect(f).not.toHaveBeenCalled();
  });

  it('never puts the phone number, message text or API key in a failure reason', async () => {
    const results = await Promise.all([
      send(reply({ statusCode: 403 })), send(reply({ statusCode: 500 })), send(new Response('', { status: 401 })), send(new TypeError('connect to +254712345678 failed')),
    ]);
    for (const r of results) {
      const reason = (r as { reason?: string }).reason ?? '';
      expect(reason).not.toMatch(/254712345678|Hello from the care team|SECRET-KEY-123/);
    }
  });
});

describe('MockProvider', () => {
  it('records what it is asked to send and returns a message id', async () => {
    const m = new MockProvider();
    const r = await m.send(msg);
    expect(r).toMatchObject({ ok: true, providerMessageId: expect.stringMatching(/^mock-/) });
    expect(m.sent).toEqual([msg]);
  });
  it('plays back scripted failures, once each, in order', async () => {
    const m = new MockProvider();
    m.queueResult({ ok: false, transient: true, reason: 'down' });
    m.queueResult({ ok: false, transient: false, reason: 'bad number' });
    expect(await m.send(msg)).toMatchObject({ transient: true });
    expect(await m.send(msg)).toMatchObject({ transient: false });
    expect((await m.send(msg)).ok).toBe(true);
    expect(m.sent).toHaveLength(1); // scripted failures are not "sent"
  });
  it('supports every channel', () => {
    expect(new MockProvider().supports('WHATSAPP')).toBe(true);
  });
});

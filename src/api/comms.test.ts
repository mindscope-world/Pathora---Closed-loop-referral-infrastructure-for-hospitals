import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../lib/api';
import * as api from './comms';

let fetchMock: ReturnType<typeof vi.fn>;
const ok = (body: unknown = {}, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const last = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, method: init.method, headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body as string) : undefined };
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken('tok');
});
afterEach(() => vi.unstubAllGlobals());

describe('communications API', () => {
  it('queues a message with an Idempotency-Key, so a double-click sends one', async () => {
    fetchMock.mockResolvedValueOnce(ok({ accepted: true, message: 'Queued for delivery.', entry: {} }, 202));
    const res = await api.sendMessage('REF-2026-0418', { templateId: 't1', channel: 'SMS' }, 'key-1');
    expect(res.accepted).toBe(true);
    const c = last();
    expect(c).toMatchObject({ url: '/api/cases/REF-2026-0418/messages', method: 'POST', body: { templateId: 't1', channel: 'SMS' } });
    expect(c.headers.get('idempotency-key')).toBe('key-1');
  });

  it('treats a refusal (200, accepted: false) as a normal outcome the screen can explain', async () => {
    fetchMock.mockResolvedValueOnce(ok({ accepted: false, message: 'The patient has opted out. Nothing was sent.', entry: { status: 'BLOCKED_OPTOUT' } }));
    const res = await api.sendMessage('REF-1', { templateId: 't1', channel: 'SMS' }, 'k');
    expect(res).toMatchObject({ accepted: false, entry: { status: 'BLOCKED_OPTOUT' } });
  });

  it('sets and clears a mobile number via PUT, sending the number only in the body', async () => {
    fetchMock.mockImplementation(async () => ok({ hasPhone: true })); // a fresh Response per call: a body can only be read once
    await api.setContact('REF-1', '0712 345 678');
    expect(last()).toMatchObject({ url: '/api/cases/REF-1/contact', method: 'PUT', body: { phone: '0712 345 678' } });
    await api.setContact('REF-1', null);
    expect(last().body).toEqual({ phone: null });
    expect(last().url).not.toMatch(/0712/);
  });

  it('records channel consent', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'REF-1' }));
    await api.setChannelConsent('REF-1', { channel: 'WHATSAPP', granted: true });
    expect(last()).toMatchObject({ url: '/api/cases/REF-1/consent', method: 'PUT', body: { channel: 'WHATSAPP', granted: true } });
  });

  it('manages templates: draft, edit, approve, retire', async () => {
    fetchMock.mockImplementation(async () => ok({ id: 't1' }));
    await api.createTemplate({ name: 'N', pathway: null, channel: 'SMS', language: 'ENGLISH', body: 'Hello {facility}' });
    expect(last()).toMatchObject({ url: '/api/templates', method: 'POST' });
    await api.updateTemplate('t 1', { body: 'x' });
    expect(last()).toMatchObject({ url: '/api/templates/t%201', method: 'PATCH', body: { body: 'x' } });
    await api.approveTemplate('t1');
    expect(last()).toMatchObject({ url: '/api/templates/t1/approve', method: 'POST' });
    await api.retireTemplate('t1');
    expect(last()).toMatchObject({ url: '/api/templates/t1/retire', method: 'POST' });
  });

  it('surfaces every wording problem the server found', async () => {
    fetchMock.mockResolvedValueOnce(ok({ error: { code: 'VALIDATION_ERROR', message: 'x', details: [{ path: 'body', message: 'remove "cancer"' }, { path: 'body', message: 'Do not put links in patient messages' }] } }, 400));
    const err = await api.createTemplate({ name: 'N', pathway: null, channel: 'SMS', language: 'ENGLISH', body: 'x' }).catch((e) => e);
    expect(err.details).toHaveLength(2);
  });

  it('reads the delivery log', async () => {
    fetchMock.mockResolvedValueOnce(ok({ entries: [], nextCursor: null }));
    await api.listCommsLog(25);
    expect(last()).toMatchObject({ url: '/api/comms-log?limit=25', method: undefined });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../lib/api';
import * as api from './rulepacks';

let fetchMock: ReturnType<typeof vi.fn>;
const ok = (body: unknown = {}, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const last = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, method: init.method, body: init.body ? JSON.parse(init.body as string) : undefined };
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken('tok');
});
afterEach(() => vi.unstubAllGlobals());

describe('rule pack API', () => {
  it('publishes a change as a PATCH carrying the version it was based on', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'RP-CANCER', version: 3 }));
    await api.updateRulePack('RP-CANCER', { ackSlaHours: 12, redFlagPolicy: { unacknowledgedHours: null }, expectedVersion: 2 });
    expect(last()).toEqual({ url: '/api/rule-packs/RP-CANCER', method: 'PATCH', body: { ackSlaHours: 12, redFlagPolicy: { unacknowledgedHours: null }, expectedVersion: 2 } });
  });

  it('surfaces a version conflict with its code', async () => {
    fetchMock.mockResolvedValueOnce(ok({ error: { code: 'VERSION_CONFLICT', message: 'now version 3' } }, 409));
    await expect(api.updateRulePack('RP-CANCER', { ackSlaHours: 12 })).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
  });

  it('exposes per-field messages for rejected timers', async () => {
    fetchMock.mockResolvedValueOnce(ok({ error: { code: 'VALIDATION_ERROR', message: 'x', details: [{ path: 'contactSlaHours', message: 'The contact window cannot be longer than the facility acknowledgment window' }] } }, 400));
    const err = await api.updateRulePack('RP-CANCER', { contactSlaHours: 99 }).catch((e) => e);
    expect(err.fieldErrors).toEqual({ contactSlaHours: 'The contact window cannot be longer than the facility acknowledgment window' });
  });

  it('reads version history and unwraps the list', async () => {
    fetchMock.mockResolvedValueOnce(ok({ versions: [{ version: 2 }, { version: 1 }] }));
    expect(await api.listRulePackVersions('RP-NCD')).toEqual([{ version: 2 }, { version: 1 }]);
    expect(last()).toMatchObject({ url: '/api/rule-packs/RP-NCD/versions' });
  });

  it('runs the synthetic test with a POST and no body', async () => {
    fetchMock.mockResolvedValueOnce(ok({ passed: true, checks: [] }));
    await api.runSyntheticTest('RP-CANCER');
    expect(last()).toMatchObject({ url: '/api/rule-packs/RP-CANCER/synthetic-test', method: 'POST', body: undefined });
  });
});

describe('notifications API', () => {
  it('marks one read (empty 204) and all read', async () => {
    fetchMock.mockResolvedValueOnce(ok(null, 204));
    await expect(api.markNotificationRead('n 1')).resolves.toBeUndefined();
    expect(last()).toMatchObject({ url: '/api/notifications/n%201/read', method: 'POST' });
    fetchMock.mockResolvedValueOnce(ok({ marked: 3 }));
    expect(await api.markAllNotificationsRead()).toEqual({ marked: 3 });
    expect(last()).toMatchObject({ url: '/api/notifications/read-all', method: 'POST' });
  });
});

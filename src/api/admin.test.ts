import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../lib/api';
import * as admin from './admin';

let fetchMock: ReturnType<typeof vi.fn>;
const ok = (body: unknown = {}, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, method: init.method, headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body as string) : undefined };
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken('tok');
});
afterEach(() => vi.unstubAllGlobals());

describe('team API', () => {
  it('invites with an Idempotency-Key and a JSON body', async () => {
    fetchMock.mockResolvedValueOnce(ok({ invite: {}, inviteUrl: 'u', emailed: false }, 201));
    await admin.inviteMember({ email: 'a@b.org', name: 'A B', role: 'FACILITY_FOCAL', facilityId: 'f1' }, 'key-123');
    const c = lastCall();
    expect(c).toMatchObject({ url: '/api/users/invite', method: 'POST', body: { email: 'a@b.org', name: 'A B', role: 'FACILITY_FOCAL', facilityId: 'f1' } });
    expect(c.headers.get('idempotency-key')).toBe('key-123');
    expect(c.headers.get('authorization')).toBe('Bearer tok');
  });

  it('PATCHes a member by id, URL-encoding it', async () => {
    fetchMock.mockResolvedValueOnce(ok({}));
    await admin.updateMember('a/b c', { active: false });
    expect(lastCall()).toMatchObject({ url: '/api/users/a%2Fb%20c', method: 'PATCH', body: { active: false } });
  });

  it('revokes an invitation and copes with the empty 204 response', async () => {
    fetchMock.mockResolvedValueOnce(ok(null, 204));
    await expect(admin.revokeInvite('inv1')).resolves.toBeUndefined();
    expect(lastCall()).toMatchObject({ url: '/api/users/invites/inv1/revoke', method: 'POST' });
  });

  it('surfaces the server’s error code and message', async () => {
    fetchMock.mockResolvedValueOnce(ok({ error: { code: 'LAST_MANAGER', message: 'The organisation must keep at least one active Programme Manager.' } }, 409));
    await expect(admin.updateMember('u1', { active: false })).rejects.toMatchObject({ status: 409, code: 'LAST_MANAGER' });
  });
});

describe('organisation and facility API', () => {
  it('updates the organisation with only the fields sent', async () => {
    fetchMock.mockResolvedValueOnce(ok({}));
    await admin.updateOrganization({ retentionDays: 730 });
    expect(lastCall()).toMatchObject({ url: '/api/organization', method: 'PATCH', body: { retentionDays: 730 } });
  });

  it('creates and edits facilities', async () => {
    fetchMock.mockImplementation(async () => ok({}, 201)); // a fresh Response per call: a body can only be read once
    await admin.createFacility({ name: 'N', type: 'FAITH_BASED', city: 'C', interopMethod: 'PORTAL_CSV' });
    expect(lastCall()).toMatchObject({ url: '/api/facilities', method: 'POST' });
    await admin.updateFacility('fac1', { city: 'Nakuru' });
    expect(lastCall()).toMatchObject({ url: '/api/facilities/fac1', method: 'PATCH', body: { city: 'Nakuru' } });
  });
});

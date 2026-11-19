import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, authApi, setAccessToken, setSessionLostHandler } from './api';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const session = (token: string) => ({ accessToken: token, expiresIn: 900, user: { id: 'u' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken(null);
  setSessionLostHandler(null);
});
afterEach(() => vi.unstubAllGlobals());

const authHeader = (call: unknown[]) => new Headers((call[1] as RequestInit).headers).get('authorization');

describe('api client', () => {
  it('sends the in-memory bearer token and parses JSON', async () => {
    setAccessToken('tok1');
    fetchMock.mockResolvedValueOnce(json(200, { ok: 1 }));
    expect(await api('/things')).toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/things');
    expect(authHeader(fetchMock.mock.calls[0])).toBe('Bearer tok1');
  });

  it('on 401 refreshes once and retries the original request with the new token', async () => {
    setAccessToken('expired');
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }))
      .mockResolvedValueOnce(json(200, session('fresh')))
      .mockResolvedValueOnce(json(200, { data: 'ok' }));
    expect(await api('/things')).toEqual({ data: 'ok' });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh');
    expect(authHeader(fetchMock.mock.calls[1])).toBeNull(); // refresh itself carries no bearer
    expect(authHeader(fetchMock.mock.calls[2])).toBe('Bearer fresh');
  });

  it('shares ONE refresh between concurrent 401s (the rotating cookie is never sent twice)', async () => {
    setAccessToken('expired');
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url === '/api/auth/refresh') {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return json(200, session('fresh'));
      }
      return new Headers(init.headers).get('authorization') === 'Bearer fresh'
        ? json(200, { ok: true })
        : json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } });
    });
    const results = await Promise.all([api('/a'), api('/b'), api('/c')]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
  });

  it('when refresh fails: notifies the app once and surfaces the 401', async () => {
    setAccessToken('expired');
    const lost = vi.fn();
    setSessionLostHandler(lost);
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid or expired access token' } }))
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'No session' } }));
    await expect(api('/things')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(lost).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no retry storm
  });

  it('does not attempt a refresh when never signed in', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }));
    await expect(api('/things')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not log out on non-401 errors', async () => {
    setAccessToken('tok');
    const lost = vi.fn();
    setSessionLostHandler(lost);
    fetchMock.mockResolvedValueOnce(json(403, { error: { code: 'FORBIDDEN', message: 'nope' } }));
    await expect(api('/things')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(lost).not.toHaveBeenCalled();
  });

  it('handles 204 and non-JSON error bodies', async () => {
    setAccessToken('tok');
    fetchMock.mockResolvedValueOnce(json(204, null));
    expect(await api('/x', { method: 'DELETE' })).toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api('/x')).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR' });
  });
});

describe('authApi', () => {
  it('treats a 401 as bad credentials (no refresh attempt) and exposes retry-after for lockouts', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }));
    await expect(authApi('/auth/login', { email: 'a', password: 'b' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(json(429, { error: { code: 'TOO_MANY_ATTEMPTS', message: 'x' } }, { 'retry-after': '600' }));
    await expect(authApi('/auth/login', {})).rejects.toMatchObject({ code: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: 600 });
  });

  it('maps VALIDATION_ERROR details to per-field messages', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, { error: { code: 'VALIDATION_ERROR', message: 'x', details: [{ path: 'password', message: 'Use at least 12 characters' }, { path: 'email', message: 'Enter a valid email address' }] } }),
    );
    const err = await authApi<never>('/auth/signup', {}).catch((e: ApiError) => e);
    expect(err.fieldErrors).toEqual({ password: 'Use at least 12 characters', email: 'Enter a valid email address' });
  });
});

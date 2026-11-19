import type { ApiErrorBody, AuthSessionResponse } from '../../shared/types';

/** Error thrown for any non-2xx API response. `code` is the server's machine-readable error code. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages from a VALIDATION_ERROR response, keyed by field name. */
  get fieldErrors(): Record<string, string> {
    if (this.code !== 'VALIDATION_ERROR' || !Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as Array<{ path?: string; message?: string }>) {
      if (d.path && d.message && !out[d.path]) out[d.path] = d.message;
    }
    return out;
  }
}

// The access token lives only in memory: it is gone on reload and unreachable from other scripts
// via storage. The long-lived refresh token is an httpOnly cookie the page JS cannot read.
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
/** Registers a callback fired when a refresh fails mid-session (so the UI can return to sign-in). */
export const setSessionLostHandler = (fn: (() => void) | null) => {
  onSessionLost = fn;
};

async function parseError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body (e.g. a proxy error page) */
  }
  const retryAfter = Number(res.headers.get('retry-after'));
  return new ApiError(
    res.status,
    body.error?.code ?? 'HTTP_ERROR',
    body.error?.message ?? `Request failed (${res.status})`,
    body.error?.details,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

async function send(path: string, init: RequestInit, withAuth: boolean): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (withAuth && accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  return fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
}

// One refresh at a time: concurrent 401s share a single in-flight request, so the rotating
// refresh cookie is never presented twice from this tab.
let refreshing: Promise<AuthSessionResponse | null> | null = null;

export function refreshSession(): Promise<AuthSessionResponse | null> {
  refreshing ??= (async () => {
    try {
      const res = await send('/auth/refresh', { method: 'POST' }, false);
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const session = (await res.json()) as AuthSessionResponse;
      accessToken = session.accessToken;
      return session;
    } catch {
      return null; // network error: leave the current token alone
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** JSON API call with the bearer token; transparently refreshes once on a 401 and retries. */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const req: RequestInit = { ...rest, ...(json !== undefined ? { body: JSON.stringify(json) } : {}) };

  let res = await send(path, req, true);
  if (res.status === 401 && accessToken) {
    const renewed = await refreshSession();
    if (!renewed) {
      onSessionLost?.();
      throw await parseError(res);
    }
    res = await send(path, req, true);
  }
  if (!res.ok) throw await parseError(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** Auth endpoints: no bearer token, and a 401 means "wrong credentials", not "expired session". */
export async function authApi<T>(path: string, json?: unknown): Promise<T> {
  const res = await send(path, { method: 'POST', ...(json !== undefined ? { body: JSON.stringify(json) } : {}) }, false);
  if (!res.ok) throw await parseError(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

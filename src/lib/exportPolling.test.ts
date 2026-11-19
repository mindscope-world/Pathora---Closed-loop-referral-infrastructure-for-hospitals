import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExportJobDto, ExportStatus } from '../../shared/types';
import { listAudit } from '../api/audit';
import { setAccessToken } from './api';
import { waitUntilReady, type PollDeps } from './exportPolling';

const job = (status: ExportStatus, extra: Partial<ExportJobDto> = {}): ExportJobDto => ({
  id: 'j1', type: 'CASES_CSV', status, fileName: 'f.csv', requestedBy: 'Me', requestedAt: '2026-11-19T10:00:00Z', completedAt: null,
  expiresAt: null, rowCount: null, byteSize: null, sha256: null, chainTip: null, error: null, downloadUrl: null, ...extra,
});

/** Fake clock: sleeping advances time instantly, so tests are fast and deterministic. */
function deps(statuses: Array<ExportJobDto>): PollDeps & { calls: number; slept: number[] } {
  let t = 0;
  const d = {
    calls: 0,
    slept: [] as number[],
    now: () => t,
    sleep: async (ms: number) => { d.slept.push(ms); t += ms; },
    getExport: async () => statuses[Math.min(d.calls++, statuses.length - 1)],
  };
  return d;
}

describe('waitUntilReady', () => {
  it('returns as soon as the job is READY, polling at the given interval', async () => {
    const d = deps([job('PENDING'), job('RUNNING'), job('READY', { downloadUrl: '/api/x', rowCount: 7 })]);
    const ready = await waitUntilReady('j1', d, 700, 90_000);
    expect(ready).toMatchObject({ status: 'READY', rowCount: 7, downloadUrl: '/api/x' });
    expect(d.calls).toBe(3);
    expect(d.slept).toEqual([700, 700, 700]);
  });

  it('does not poll again after it is ready', async () => {
    const d = deps([job('READY')]);
    await waitUntilReady('j1', d);
    expect(d.calls).toBe(1);
  });

  it('surfaces the server’s safe failure message', async () => {
    const d = deps([job('RUNNING'), job('FAILED', { error: 'The export could not be generated. Please try again.' })]);
    await expect(waitUntilReady('j1', d)).rejects.toThrow('The export could not be generated. Please try again.');
  });

  it('treats an expired job as a failure rather than waiting forever', async () => {
    await expect(waitUntilReady('j1', deps([job('EXPIRED')]))).rejects.toThrow(/could not be generated/);
  });

  it('gives up after the time limit with a message that says where to find the export', async () => {
    const d = deps([job('PENDING')]);
    await expect(waitUntilReady('j1', d, 1000, 10_000)).rejects.toThrow(/Recent exports/);
    expect(d.calls).toBe(10); // 10 polls of 1s within the 10s budget, then stop
  });

  it('propagates a network/API error instead of swallowing it', async () => {
    const d = deps([job('PENDING')]);
    d.getExport = async () => { throw new Error('offline'); };
    await expect(waitUntilReady('j1', d)).rejects.toThrow('offline');
  });
});

describe('listAudit request building', () => {
  afterEach(() => vi.unstubAllGlobals());
  const urlOf = async (args: Parameters<typeof listAudit>[0]) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [], nextCursor: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('t');
    await listAudit(args);
    return fetchMock.mock.calls[0][0] as string;
  };

  it('sends a default page size and omits empty filters', async () => {
    expect(await urlOf({})).toBe('/api/audit?limit=50');
    expect(await urlOf({ q: '   ' })).toBe('/api/audit?limit=50');
  });
  it('trims and URL-encodes the search text, and passes the cursor through', async () => {
    const url = await urlOf({ q: '  REF-2026-0418 & co  ', cursor: 'abc_-' });
    expect(url).toBe('/api/audit?limit=50&q=REF-2026-0418+%26+co&cursor=abc_-');
  });
});

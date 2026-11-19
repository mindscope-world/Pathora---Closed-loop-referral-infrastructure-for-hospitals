import type { ExportJobDto } from '../../shared/types';
import { getExport } from '../api/audit';

export interface PollDeps {
  getExport: (id: string) => Promise<ExportJobDto>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const realDeps: PollDeps = {
  getExport,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

export const POLL_MS = 700;
export const GIVE_UP_MS = 90_000;

/**
 * Waits for a queued export to finish. Resolves with the READY job; throws an Error whose message is
 * safe to show the user if generation failed, or if it is still not ready after `giveUpMs` (the
 * export keeps going on the server and appears under "Recent exports").
 */
export async function waitUntilReady(id: string, deps: PollDeps = realDeps, pollMs = POLL_MS, giveUpMs = GIVE_UP_MS): Promise<ExportJobDto> {
  const deadline = deps.now() + giveUpMs;
  while (deps.now() < deadline) {
    await deps.sleep(pollMs);
    const job = await deps.getExport(id);
    if (job.status === 'READY') return job;
    if (job.status === 'FAILED' || job.status === 'EXPIRED') throw new Error(job.error ?? 'The export could not be generated.');
  }
  throw new Error('The export is taking longer than expected. It will appear under Recent exports when it is ready.');
}

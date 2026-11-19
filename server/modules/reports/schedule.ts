import type { ReportFrequency } from '../../../shared/types';

/** Reports run at 06:00 East Africa Time (UTC+3), so staff find them waiting at the start of the working day. */
const RUN_HOUR_UTC = 3;
const DAY_MS = 86_400_000;

/** The first run strictly after `after`: the next Monday (weekly) or the 1st of next month (monthly). */
export function nextRunAfter(frequency: ReportFrequency, after: Date): Date {
  if (frequency === 'WEEKLY') {
    const d = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), RUN_HOUR_UTC));
    const daysToMonday = (8 - d.getUTCDay()) % 7 || 7; // always moves forward, even when `after` is a Monday
    let next = new Date(d.getTime() + daysToMonday * DAY_MS);
    if (daysToMonday === 7 && after.getTime() < d.getTime()) next = d; // Monday before 06:00 EAT: today's run
    return next;
  }
  const thisMonth = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), 1, RUN_HOUR_UTC));
  return thisMonth.getTime() > after.getTime() ? thisMonth : new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + 1, 1, RUN_HOUR_UTC));
}

/** The period a run covers: the week or month that has just ended, ending at the run time. */
export function periodFor(frequency: ReportFrequency, runAt: Date): { from: Date; to: Date } {
  const from =
    frequency === 'WEEKLY'
      ? new Date(runAt.getTime() - 7 * DAY_MS)
      : new Date(Date.UTC(runAt.getUTCFullYear(), runAt.getUTCMonth() - 1, 1, RUN_HOUR_UTC));
  return { from, to: runAt };
}

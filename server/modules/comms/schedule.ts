/**
 * When automated patient messages may go out, and how failed ones are retried.
 *
 * No automated message is sent between 21:00 and 07:00 East Africa Time: a buzzing phone at night is
 * intrusive, and for a sensitive follow-up it can be exposing. A message requested during quiet hours
 * is held and released at 07:00.
 */
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 7;
const EAT_OFFSET_MS = 3 * 3_600_000; // East Africa Time is UTC+3 all year (no daylight saving)
const HOUR_MS = 3_600_000;

const eatHour = (d: Date) => new Date(d.getTime() + EAT_OFFSET_MS).getUTCHours();

export function inQuietHours(now: Date): boolean {
  const h = eatHour(now);
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/** The earliest moment at or after `now` when an automated message may be sent. */
export function nextAllowedTime(now: Date): Date {
  if (!inQuietHours(now)) return now;
  const eat = new Date(now.getTime() + EAT_OFFSET_MS);
  const startOfEatDayUtc = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate()) - EAT_OFFSET_MS;
  const releaseToday = startOfEatDayUtc + QUIET_END_HOUR * HOUR_MS;
  // After 21:00 the next 07:00 is tomorrow's; before 07:00 it is today's.
  return new Date(eat.getUTCHours() >= QUIET_START_HOUR ? releaseToday + 24 * HOUR_MS : releaseToday);
}

/** Total tries per message (the first plus retries). */
export const MAX_ATTEMPTS = 5;
/** Delay before retry n (1-based): 1 min, 5 min, 30 min, 2 h. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * HOUR_MS];

/** When a message that has failed `attempts` times may be tried again; null when it should be given up on. */
export function nextRetryTime(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return nextAllowedTime(new Date(now.getTime() + BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1]));
}

/** A patient may be sent at most this many automated messages in any rolling 24 hours. */
export const MAX_MESSAGES_PER_PATIENT_PER_DAY = 3;

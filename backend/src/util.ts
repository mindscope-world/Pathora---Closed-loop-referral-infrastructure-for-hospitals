/** Timestamp in the same `YYYY-MM-DD HH:mm` format the dashboard displays. */
export function nowTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/** Date `days` from now in `YYYY-MM-DD` format. */
export function dateFromNow(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return nowTimestamp(d).slice(0, 10);
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

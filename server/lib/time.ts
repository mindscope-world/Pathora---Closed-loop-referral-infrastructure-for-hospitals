/** Pathora operates in Kenya. Business dates (ref-number year, due dates) use East Africa Time. */
export const TIME_ZONE = 'Africa/Nairobi';

export function yearInNairobi(d: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric' }).format(d));
}

/** Parses the 'YYYY-MM-DD[ HH:mm]' wall-clock strings used in the demo data as East Africa Time (UTC+3, no DST). */
export function parseEat(value: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/.exec(value);
  if (!m) throw new Error(`Unparseable date: ${value}`);
  return new Date(`${m[1]}T${m[2] ?? '00:00'}:00+03:00`);
}

/** 'YYYYMMDD-HHmm' in East Africa Time, for file names. */
export function compactStamp(d: Date = new Date()): string {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)) parts[p.type] = p.value;
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
}

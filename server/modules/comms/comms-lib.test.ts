import { describe, expect, it } from 'vitest';
import { classifyReply } from './keywords';
import { MAX_ATTEMPTS, inQuietHours, nextAllowedTime, nextRetryTime } from './schedule';
import { MAX_TEMPLATE_CHARS, CLINICAL_TERMS, lintTemplateBody, placeholdersIn, renderTemplate } from './template';

describe('template lint: messages must be discreet', () => {
  const ok = (b: string) => expect(lintTemplateBody(b), b).toEqual([]);
  const bad = (b: string, mentions: string) =>
    expect(lintTemplateBody(b).map((p) => p.message).join(' | '), b).toContain(mentions);

  it('accepts the shipped discreet wording', () => {
    ok('Hello, this is your care coordinator. Your follow-up slot is ready at {facility}. Reply 1 to confirm or call {phone} for support.');
    ok('Habari, hili ni kumbusho la siri kuhusu miadi yako ya ufuatiliaji katika {facility}. Jibu NDIYO kuthibitisha au wasiliana nasi kwa msaada wa usafiri.');
    ok('Reminder: please visit {facility} within 48 hours for your confirmatory check-up. No clinical details are shared in this message.');
    ok('Your private follow-up summary is ready. Tap your secure link to view next steps or choose a preferred clinic time.');
  });

  it.each([
    ['Your cancer screening result is ready', 'cancer'],
    ['Your CERVICAL appointment at {facility}', 'cervical'],
    ['Please attend for your biopsy', 'biop'],
    ['Your HIV test', 'hiv'],
    ['Diabetes follow-up at {facility}', 'diabet'],
    ['Your blood pressure was high', 'blood pressure'],
    ['Your results are ready', 'result'],
    ['Matokeo yako yako tayari', 'matokeo'],
    ['Una saratani', 'saratani'],
    ['You tested positive', 'positive'],
    ['Prostate check at {facility}', 'prostate'],
    ['Your pregnancy visit', 'pregnan'],
    ['oncologist will see you', 'oncolog'],
    ['Colposcopy booked', 'colposcop'],
  ])('rejects clinical wording: %j', (body, term) => bad(body, term));

  it('treats "screening" as clinical: it tells onlookers the person had a health screening', () => {
    bad('Hello, this is your care coordinator from the screening team.', 'screening');
    bad('You were screened last week', 'screened');
  });

  it('matches whole words for short acronyms, so ordinary words are not blocked', () => {
    ok('Your history of visits is on file at {facility}'); // contains "sti" inside "history"
    ok('Please bring your stationery'); // "sti" inside a word
    ok('We will assist you'); // "ass-ist"
    bad('Possible STI', 'sti');
    bad('A std clinic', 'std');
  });

  it('rejects links, unknown placeholders, stray braces and over-long text', () => {
    bad('Visit https://example.org now', 'links');
    bad('See www.example.org', 'links');
    bad('Hello {name}, see {facility}', 'Unknown placeholder {name}');
    bad('Hello {facility', 'unmatched');
    bad('Hello facility}', 'unmatched');
    bad('x'.repeat(MAX_TEMPLATE_CHARS + 1), `${MAX_TEMPLATE_CHARS} characters`);
    ok('x'.repeat(MAX_TEMPLATE_CHARS));
  });

  it('reports every problem at once, so it can be fixed in one pass', () => {
    const m = lintTemplateBody('Your cancer result at {clinic}, see www.x.org').map((p) => p.message);
    expect(m.length).toBe(3);
  });

  it('every listed term is actually caught (no dead entries)', () => {
    for (const t of CLINICAL_TERMS) {
      const sample = t.endsWith('*') ? `${t.slice(0, -1)}x` : t;
      expect(lintTemplateBody(`Hello ${sample} there`).length, t).toBeGreaterThan(0);
    }
  });
});

describe('placeholders', () => {
  it('lists the allowed ones used, once each', () => {
    expect(placeholdersIn('At {facility}, call {phone}, again {facility}')).toEqual(['facility', 'phone']);
    expect(placeholdersIn('Nothing here')).toEqual([]);
    expect(placeholdersIn('Unknown {name}')).toEqual([]);
  });
  it('renders values as plain text, never interpreting them', () => {
    expect(renderTemplate('Visit {facility}, call {phone}.', { facility: 'St. Luke {phone} $& Clinic', phone: '0700 000 000' }))
      .toBe('Visit St. Luke {phone} $& Clinic, call 0700 000 000.');
  });
});

describe('quiet hours (East Africa Time, UTC+3)', () => {
  const eat = (iso: string) => new Date(`${iso}+03:00`);
  it('is quiet from 21:00 until 07:00', () => {
    expect(inQuietHours(eat('2026-11-19T20:59:59'))).toBe(false);
    expect(inQuietHours(eat('2026-11-19T21:00:00'))).toBe(true);
    expect(inQuietHours(eat('2026-11-19T23:30:00'))).toBe(true);
    expect(inQuietHours(eat('2026-11-20T00:00:00'))).toBe(true);
    expect(inQuietHours(eat('2026-11-20T06:59:59'))).toBe(true);
    expect(inQuietHours(eat('2026-11-20T07:00:00'))).toBe(false);
    expect(inQuietHours(eat('2026-11-20T12:00:00'))).toBe(false);
  });
  it('sends now when allowed', () => {
    const t = eat('2026-11-19T10:00:00');
    expect(nextAllowedTime(t)).toEqual(t);
  });
  it('holds an evening request until 07:00 the next morning', () => {
    expect(nextAllowedTime(eat('2026-11-19T21:30:00'))).toEqual(eat('2026-11-20T07:00:00'));
    expect(nextAllowedTime(eat('2026-11-19T23:59:59'))).toEqual(eat('2026-11-20T07:00:00'));
  });
  it('holds a small-hours request until 07:00 the same morning', () => {
    expect(nextAllowedTime(eat('2026-11-20T00:00:00'))).toEqual(eat('2026-11-20T07:00:00'));
    expect(nextAllowedTime(eat('2026-11-20T03:15:00'))).toEqual(eat('2026-11-20T07:00:00'));
    expect(nextAllowedTime(eat('2026-11-20T06:59:59'))).toEqual(eat('2026-11-20T07:00:00'));
  });
  it('handles month and year boundaries', () => {
    expect(nextAllowedTime(eat('2026-11-30T22:00:00'))).toEqual(eat('2026-12-01T07:00:00'));
    expect(nextAllowedTime(eat('2026-12-31T22:00:00'))).toEqual(eat('2027-01-01T07:00:00'));
  });
  it('is a fixed offset: the UTC date can differ from the Nairobi date', () => {
    // 22:30 UTC on the 19th is 01:30 EAT on the 20th: still quiet, released at 07:00 EAT on the 20th
    expect(nextAllowedTime(new Date('2026-11-19T22:30:00Z'))).toEqual(eat('2026-11-20T07:00:00'));
  });
});

describe('retry schedule', () => {
  const noon = new Date('2026-11-19T09:00:00Z'); // 12:00 EAT
  it('backs off 1 min, 5 min, 30 min, 2 h', () => {
    expect(nextRetryTime(1, noon)!.getTime() - noon.getTime()).toBe(60_000);
    expect(nextRetryTime(2, noon)!.getTime() - noon.getTime()).toBe(5 * 60_000);
    expect(nextRetryTime(3, noon)!.getTime() - noon.getTime()).toBe(30 * 60_000);
    expect(nextRetryTime(4, noon)!.getTime() - noon.getTime()).toBe(2 * 3_600_000);
  });
  it('gives up after the maximum attempts', () => {
    expect(nextRetryTime(MAX_ATTEMPTS, noon)).toBeNull();
    expect(nextRetryTime(MAX_ATTEMPTS + 3, noon)).toBeNull();
  });
  it('never schedules a retry into quiet hours', () => {
    const late = new Date('2026-11-19T17:59:30Z'); // 20:59:30 EAT; +1 min lands in quiet hours
    expect(nextRetryTime(1, late)).toEqual(new Date('2026-11-20T04:00:00Z')); // 07:00 EAT
  });
});

describe('classifyReply', () => {
  it.each(['STOP', 'stop', ' Stop. ', 'STOP!', 'Unsubscribe', 'END', 'QUIT', 'cancel', 'ACHA', 'Simamisha', 'sitaki', 'opt out', 'STOPALL'])('%j is an opt-out', (t) => expect(classifyReply(t)).toBe('OPT_OUT'));
  it.each(['START', 'start', 'Anza', 'UNSTOP', 'subscribe', 'endelea'])('%j re-subscribes', (t) => expect(classifyReply(t)).toBe('RESTORE'));
  it.each(['1', 'YES', 'yes!', 'Ndiyo', 'NDIO', 'ok', 'Sawa', ' y '])('%j confirms', (t) => expect(classifyReply(t)).toBe('CONFIRM'));
  it.each(['', '   ', 'maybe later', 'I will come tomorrow', 'please stop calling me about this', '2', 'stop it', 'my sister has cancer too'])('%j is something else, to be read by a person', (t) => expect(classifyReply(t)).toBe('OTHER'));
  it('treats full-width and decorated variants like plain ones', () => {
    expect(classifyReply('ＳＴＯＰ')).toBe('OPT_OUT');
    expect(classifyReply('*STOP*')).toBe('OPT_OUT');
  });
});

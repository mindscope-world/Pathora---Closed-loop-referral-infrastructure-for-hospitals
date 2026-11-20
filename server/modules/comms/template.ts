/**
 * Patient message templates: what they may say, and how they are filled in.
 *
 * Messages go to a person's own phone, which others may see. So templates must be discreet: no clinical
 * terms, no links, and only a small set of placeholders that cannot leak anything about the patient.
 */
export const PLACEHOLDERS = ['facility', 'phone'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export const MAX_TEMPLATE_CHARS = 320;
export const MAX_RENDERED_CHARS = 480;

/**
 * Words that must never appear in a message to a patient, in English and Kiswahili. Matching is
 * case-insensitive; entries ending in * match any continuation (oncolog* → oncology, oncologist).
 * Short acronyms must match as whole words so they do not fire inside ordinary words.
 */
export const CLINICAL_TERMS = [
  'cancer*', 'carcinoma', 'tumo*', 'oncolog*', 'malignan*', 'benign', 'biops*', 'colposcop*', 'cervical', 'pap smear', 'mammogra*',
  'lesion*', 'dysplasia', 'chemo*', 'radiotherap*', 'hiv', 'aids', 'ukimwi', 'std', 'sti', 'syphilis', 'gonorrh*',
  'diabet*', 'kisukari', 'hypertens*', 'blood pressure', 'shinikizo', 'hba1c', 'glucose', 'prostate', 'urolog*', 'erectile', 'infertil*',
  'pregnan*', 'mimba', 'diagnos*', 'screening', 'screened', 'positive', 'negative', 'abnormal', 'high risk', 'result', 'results', 'matokeo',
  'saratani', 'uvimbe',
];

/** "cancer*" matches any word starting "cancer"; a plain entry matches that whole word (or phrase) only. */
const termRegex = (t: string) => {
  const prefix = t.endsWith('*');
  const stem = t.replace(/\*$/, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${stem}${prefix ? '\\w*' : '\\b'}`, 'i');
};
const COMPILED = CLINICAL_TERMS.map((t) => ({ term: t.replace(/\*$/, ''), re: termRegex(t) }));

export interface TemplateProblem {
  message: string;
}

/** Everything wrong with a template body, or an empty list if it may be saved. */
export function lintTemplateBody(body: string): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  if (body.length > MAX_TEMPLATE_CHARS) problems.push({ message: `Keep messages to ${MAX_TEMPLATE_CHARS} characters or fewer (an SMS is billed per 160)` });

  const found = new Set<string>();
  for (const { term, re } of COMPILED) if (re.test(body)) found.add(term);
  if (found.size > 0) {
    problems.push({ message: `Messages must stay discreet: remove ${[...found].map((t) => `"${t}"`).join(', ')}. No clinical terms may be sent to a patient.` });
  }
  if (/(https?:\/\/|www\.)/i.test(body)) problems.push({ message: 'Do not put links in patient messages' });

  const unknown = new Set<string>();
  for (const m of body.matchAll(/\{([^{}]*)\}/g)) if (!(PLACEHOLDERS as readonly string[]).includes(m[1])) unknown.add(m[1]);
  if (unknown.size > 0) problems.push({ message: `Unknown placeholder ${[...unknown].map((u) => `{${u}}`).join(', ')}. Allowed: ${PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}` });
  // Braces left over after removing valid-looking placeholders mean a typo like "{facility" or "facility}".
  if (/[{}]/.test(body.replace(/\{[^{}]*\}/g, ''))) problems.push({ message: 'A { or } is unmatched' });
  return problems;
}

export function placeholdersIn(body: string): Placeholder[] {
  const used = new Set<Placeholder>();
  for (const m of body.matchAll(/\{([^{}]*)\}/g)) if ((PLACEHOLDERS as readonly string[]).includes(m[1])) used.add(m[1] as Placeholder);
  return [...used];
}

/** Fills placeholders. Values are plain text; nothing is interpreted, so a facility name cannot inject anything. */
export function renderTemplate(body: string, values: Record<Placeholder, string>): string {
  return body.replace(/\{(facility|phone)\}/g, (_m, key: Placeholder) => values[key]);
}

import type { InboundKind } from '../../db/generated/client';

/**
 * Understanding a patient's reply. Only the MEANING is kept; the text itself is never stored, because a free
 * reply ("my sister has cancer too") can contain clinical details this system must not hold.
 *
 * Opting out must always work, so the STOP list is generous (English and Kiswahili, and the standard
 * carrier keywords) and matching ignores case, punctuation and surrounding spaces.
 */
const OPT_OUT = new Set(['stop', 'stopall', 'end', 'quit', 'cancel', 'unsubscribe', 'optout', 'opt out', 'acha', 'simamisha', 'sitaki']);
const RESTORE = new Set(['start', 'unstop', 'subscribe', 'anza', 'endelea']);
const CONFIRM = new Set(['1', 'y', 'yes', 'ok', 'okay', 'ndiyo', 'ndio', 'sawa']);

const clean = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

export function classifyReply(text: string): InboundKind {
  const t = clean(text);
  if (OPT_OUT.has(t)) return 'OPT_OUT';
  if (RESTORE.has(t)) return 'RESTORE';
  if (CONFIRM.has(t)) return 'CONFIRM';
  return 'OTHER';
}

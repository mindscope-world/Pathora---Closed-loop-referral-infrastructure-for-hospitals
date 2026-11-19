import { z } from 'zod';

/**
 * Single-line display text (names, titles, labels). Rejects control characters, including newlines.
 * These strings end up in email subjects, audit entries and CSV files, where an embedded line break
 * could inject mail headers or break out of a record.
 */
export const printableText = (min: number, max: number, requiredMessage: string) =>
  z
    .string()
    .trim()
    .min(min, requiredMessage)
    .max(max, `Use at most ${max} characters`)
    .refine((v) => !/\p{Cc}/u.test(v), 'Remove line breaks and other control characters');

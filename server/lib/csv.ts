/**
 * CSV writing for exports (RFC 4180 quoting) with spreadsheet-formula neutralisation.
 *
 * Why this matters: free text such as a source programme or a closure reason ends up in exports that
 * people open in Excel/Sheets. A cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage return
 * is interpreted as a FORMULA ("CSV injection"), which can exfiltrate data or run commands on the
 * reader's machine. Text cells that start with one of those characters are prefixed with a single
 * quote, the standard defence (OWASP). Numbers and booleans are written as typed values, so a
 * legitimate negative number (e.g. -14 hours remaining) is untouched.
 */

/** Byte-order mark so Excel opens the file as UTF-8 (names and Kiswahili text survive). */
export const CSV_BOM = '﻿';

const FORMULA_START = /^[=+\-@\t\r]/;

export type CsvValue = string | number | boolean | Date | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let text = value instanceof Date ? value.toISOString() : value;
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV record, CRLF-terminated. */
export const csvRow = (values: CsvValue[]): string => `${values.map(csvCell).join(',')}\r\n`;

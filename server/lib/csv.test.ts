import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvCell, csvRow } from './csv';

describe('csvCell: quoting (RFC 4180)', () => {
  it('leaves plain text alone and quotes commas, quotes and newlines', () => {
    expect(csvCell('plain text')).toBe('plain text');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('cr\rlf')).toBe('"cr\rlf"');
  });
  it('renders empties, booleans, dates and numbers', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('')).toBe('');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(false)).toBe('false');
    expect(csvCell(new Date('2026-11-17T06:15:00.123Z'))).toBe('2026-11-17T06:15:00.123Z');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('');
  });
  it('keeps unicode (names, Kiswahili) intact', () => {
    expect(csvCell('Wanjiru Kamau · Habari yako, Mwangi')).toBe('"Wanjiru Kamau · Habari yako, Mwangi"');
  });
});

describe('csvCell: spreadsheet formula injection', () => {
  it.each([
    '=SUM(A1:A9)',
    '=HYPERLINK("http://evil.example","click")',
    '+1+1',
    '-2+3',
    '@SUM(1)',
    '\t=1+1',
    '\r=1+1',
    "=cmd|' /C calc'!A0",
  ])('neutralises %j so no cell can start as a formula', (payload) => {
    const cell = csvCell(payload);
    const decoded = cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
    expect(decoded.startsWith("'")).toBe(true);
    expect(/^[=+\-@\t\r]/.test(decoded)).toBe(false);
    // and the original text is still fully present after the marker
    expect(decoded.slice(1)).toBe(payload);
  });

  it('does not touch text that merely contains those characters, or ordinary values', () => {
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell('x-ray follow-up')).toBe('x-ray follow-up');
    expect(csvCell('mail me @ home')).toBe('mail me @ home');
    expect(csvCell('2026-11-17T06:15:00.000Z')).toBe('2026-11-17T06:15:00.000Z');
    expect(csvCell('REF-2026-0418')).toBe('REF-2026-0418');
  });

  it('writes numbers as numbers: a legitimate negative value is NOT mangled', () => {
    expect(csvCell(-14)).toBe('-14');
    expect(csvCell(-0.5)).toBe('-0.5');
  });

  it('survives a real CSV parser round-trip with hostile content', () => {
    const [row] = parse(csvRow(['=1+1', '"quoted",=cmd', '+HYPERLINK("x")', 'normal']), { relax_column_count: true }) as string[][];
    expect(row).toEqual(["'=1+1", '"quoted",=cmd', "'+HYPERLINK(\"x\")", 'normal']);
    // (the second cell starts with a quote character, not a formula character, so it is unchanged)
    expect(row.every((c) => !/^[=+\-@\t\r]/.test(c))).toBe(true);
  });
});

describe('csvRow', () => {
  it('joins with commas and ends with CRLF', () => {
    expect(csvRow(['a', 1, true, null, 'b,c'])).toBe('a,1,true,,"b,c"\r\n');
  });
  it('exposes a UTF-8 BOM for Excel', () => {
    expect(CSV_BOM).toBe('﻿');
  });
});

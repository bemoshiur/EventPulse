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

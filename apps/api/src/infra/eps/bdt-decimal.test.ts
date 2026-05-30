/**
 * BDT-decimal parser — unit tests.
 *
 * Pins the IEEE-754-free contract: every accepted input round-trips to
 * paisa bigint bit-exactly; every rejected input throws with a clear
 * message rather than silently losing money.
 */

import { describe, expect, it } from 'vitest'

import { parseBdtDecimalToPaisa } from './bdt-decimal.js'

describe('parseBdtDecimalToPaisa — happy path', () => {
  it('parses "0" → 0n', () => {
    expect(parseBdtDecimalToPaisa('0')).toBe(0n)
  })
  it('parses "0.00" → 0n', () => {
    expect(parseBdtDecimalToPaisa('0.00')).toBe(0n)
  })
  it('parses "1" → 100n', () => {
    expect(parseBdtDecimalToPaisa('1')).toBe(100n)
  })
  it('parses "1.00" → 100n (EPS V4 small-amount example)', () => {
    expect(parseBdtDecimalToPaisa('1.00')).toBe(100n)
  })
  it('parses "1.05" → 105n', () => {
    expect(parseBdtDecimalToPaisa('1.05')).toBe(105n)
  })
  it('parses "1027.56" → 102756n (Mode A buyer total)', () => {
    expect(parseBdtDecimalToPaisa('1027.56')).toBe(102756n)
  })
  it('parses "1025.00" → 102500n (Mode C calculator prediction)', () => {
    expect(parseBdtDecimalToPaisa('1025.00')).toBe(102500n)
  })
  it('parses "1025.06" → 102506n (Mode C §14.2 narrative prediction)', () => {
    expect(parseBdtDecimalToPaisa('1025.06')).toBe(102506n)
  })
  it('parses "1002.50" → 100250n (Mode D buyer total)', () => {
    expect(parseBdtDecimalToPaisa('1002.50')).toBe(100250n)
  })
  it('parses "1000.00" → 100000n (Mode B buyer total)', () => {
    expect(parseBdtDecimalToPaisa('1000.00')).toBe(100000n)
  })
  it('parses very large amounts bit-exactly (no IEEE-754 loss)', () => {
    expect(parseBdtDecimalToPaisa('999999999999.99')).toBe(99999999999999n)
  })
})

describe('parseBdtDecimalToPaisa — IEEE-754 regression guard', () => {
  it('matches a known parseFloat-loses-paisa case', () => {
    // parseFloat('1027.57') * 100 === 102756.99999999999 — off by 1 paisa.
    // String-based parser must hit 102757n bit-exactly.
    expect(parseBdtDecimalToPaisa('1027.57')).toBe(102757n)
  })
})

describe('parseBdtDecimalToPaisa — rejection cases (no silent money loss)', () => {
  const rejected: Array<{ input: string; why: string }> = [
    { input: '', why: 'empty' },
    { input: '1027.5', why: 'one-decimal' },
    { input: '1027.567', why: 'three-decimal' },
    { input: '1027.', why: 'trailing dot' },
    { input: '.50', why: 'leading dot' },
    { input: '-1.00', why: 'signed' },
    { input: '+1.00', why: 'plus signed' },
    { input: '1e3', why: 'exponent' },
    { input: ' 1.00', why: 'leading whitespace' },
    { input: '1.00 ', why: 'trailing whitespace' },
    { input: '1,000.00', why: 'thousands separator' },
    { input: '1.0a', why: 'alpha tail' },
    { input: '1.00.00', why: 'double decimal' },
    { input: 'NaN', why: 'NaN literal' },
  ]
  for (const { input, why } of rejected) {
    it(`rejects '${input}' (${why}) with RangeError`, () => {
      expect(() => parseBdtDecimalToPaisa(input)).toThrow(RangeError)
    })
  }

  it('rejects non-string inputs', () => {
    expect(() => parseBdtDecimalToPaisa(102756 as unknown as string)).toThrow(TypeError)
    expect(() => parseBdtDecimalToPaisa(null as unknown as string)).toThrow(TypeError)
    expect(() => parseBdtDecimalToPaisa(undefined as unknown as string)).toThrow(TypeError)
  })
})

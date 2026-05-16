import { describe, expect, it } from 'vitest'
import { bdtToPaisa, formatBdt, formatBdtNumber, paisaToBdt } from './currency.js'

describe('currency', () => {
  describe('bdtToPaisa', () => {
    it('handles whole BDT amounts', () => {
      expect(bdtToPaisa('1000')).toBe(100_000n)
      expect(bdtToPaisa('1')).toBe(100n)
      expect(bdtToPaisa('0')).toBe(0n)
    })

    it('handles one-decimal and two-decimal amounts', () => {
      expect(bdtToPaisa('1000.5')).toBe(100_050n)
      expect(bdtToPaisa('1000.50')).toBe(100_050n)
      expect(bdtToPaisa('1000.05')).toBe(100_005n)
      expect(bdtToPaisa('0.01')).toBe(1n)
    })

    it('handles negative amounts (for refunds)', () => {
      expect(bdtToPaisa('-50.00')).toBe(-5000n)
      expect(bdtToPaisa('-0.01')).toBe(-1n)
    })

    it('rejects invalid input', () => {
      expect(() => bdtToPaisa('1.234')).toThrow(/not a valid/)
      expect(() => bdtToPaisa('abc')).toThrow(/not a valid/)
      expect(() => bdtToPaisa('')).toThrow(/not a valid/)
    })
  })

  describe('paisaToBdt', () => {
    it('converts paisa to BDT number', () => {
      expect(paisaToBdt(100_000n)).toBe(1000)
      expect(paisaToBdt(100_050n)).toBe(1000.5)
      expect(paisaToBdt(1n)).toBe(0.01)
      expect(paisaToBdt(0n)).toBe(0)
    })
  })

  describe('formatBdt / formatBdtNumber', () => {
    it('formats with currency symbol', () => {
      // Output uses en-BD locale; on common runtimes this resolves to "BDT 1,000.00".
      // We assert structure (digits + thousands separator + 2 decimals) rather than exact glyphs.
      const formatted = formatBdt(100_000n)
      expect(formatted).toMatch(/1,?000\.00/)
      expect(formatted.toUpperCase()).toContain('BDT')
    })

    it('formats without currency symbol', () => {
      expect(formatBdtNumber(100_000n)).toMatch(/^1,?000\.00$/)
      expect(formatBdtNumber(1n)).toMatch(/^0\.01$/)
    })
  })
})

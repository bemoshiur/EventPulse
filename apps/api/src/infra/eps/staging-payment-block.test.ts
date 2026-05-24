/**
 * STAGING_PAYMENT_BLOCK guard — unit tests.
 *
 * The guard is the only thing preventing accidental real charges in
 * staging until MVP production cutover. Every behavioural rule is
 * regression-tested here.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  assertEpsCallAllowed,
  isStagingPaymentBlockEnabled,
  StagingPaymentBlockedError,
} from './staging-payment-block.js'

describe('STAGING_PAYMENT_BLOCK guard', () => {
  const ORIGINAL = process.env['STAGING_PAYMENT_BLOCK']

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env['STAGING_PAYMENT_BLOCK']
    } else {
      process.env['STAGING_PAYMENT_BLOCK'] = ORIGINAL
    }
  })

  describe('isStagingPaymentBlockEnabled', () => {
    it('is true when STAGING_PAYMENT_BLOCK === "1"', () => {
      process.env['STAGING_PAYMENT_BLOCK'] = '1'
      expect(isStagingPaymentBlockEnabled()).toBe(true)
    })

    it('is false when STAGING_PAYMENT_BLOCK is unset', () => {
      delete process.env['STAGING_PAYMENT_BLOCK']
      expect(isStagingPaymentBlockEnabled()).toBe(false)
    })

    it('is false when STAGING_PAYMENT_BLOCK === "0"', () => {
      process.env['STAGING_PAYMENT_BLOCK'] = '0'
      expect(isStagingPaymentBlockEnabled()).toBe(false)
    })

    it('treats only the literal string "1" as on (not "true", "yes", "on")', () => {
      for (const value of ['true', 'yes', 'on', 'TRUE', 'YES', 'ON', '1 ', ' 1', '01']) {
        process.env['STAGING_PAYMENT_BLOCK'] = value
        expect(isStagingPaymentBlockEnabled()).toBe(false)
      }
    })

    it('reads process.env at call time, not at module load', () => {
      delete process.env['STAGING_PAYMENT_BLOCK']
      expect(isStagingPaymentBlockEnabled()).toBe(false)
      process.env['STAGING_PAYMENT_BLOCK'] = '1'
      expect(isStagingPaymentBlockEnabled()).toBe(true)
    })
  })

  describe('assertEpsCallAllowed — block on', () => {
    beforeEach(() => {
      process.env['STAGING_PAYMENT_BLOCK'] = '1'
    })

    it('allows zero-paisa (free event) calls', () => {
      expect(() => assertEpsCallAllowed(0n)).not.toThrow()
    })

    it('refuses 1-paisa calls (smallest priced order)', () => {
      expect(() => assertEpsCallAllowed(1n)).toThrow(StagingPaymentBlockedError)
    })

    it('refuses typical BDT 1,000 orders (100,000 paisa)', () => {
      expect(() => assertEpsCallAllowed(100_000n)).toThrow(StagingPaymentBlockedError)
    })

    it('refuses very large orders', () => {
      expect(() => assertEpsCallAllowed(10_000_000_000n)).toThrow(StagingPaymentBlockedError)
    })

    it('error carries totalPaisa for diagnostics', () => {
      try {
        assertEpsCallAllowed(123_456n)
        throw new Error('expected throw')
      } catch (err) {
        expect(err).toBeInstanceOf(StagingPaymentBlockedError)
        expect((err as StagingPaymentBlockedError).totalPaisa).toBe(123_456n)
      }
    })

    it('error message names the env var for greppable diagnostics', () => {
      try {
        assertEpsCallAllowed(100n)
        throw new Error('expected throw')
      } catch (err) {
        expect((err as Error).message).toContain('STAGING_PAYMENT_BLOCK')
        expect((err as Error).message).toContain('100 paisa')
      }
    })

    it('error name is StagingPaymentBlockedError (greppable)', () => {
      try {
        assertEpsCallAllowed(100n)
        throw new Error('expected throw')
      } catch (err) {
        expect((err as Error).name).toBe('StagingPaymentBlockedError')
      }
    })
  })

  describe('assertEpsCallAllowed — block off', () => {
    it('allows priced calls when env var is unset', () => {
      delete process.env['STAGING_PAYMENT_BLOCK']
      expect(() => assertEpsCallAllowed(100_000n)).not.toThrow()
    })

    it('allows priced calls when env var === "0"', () => {
      process.env['STAGING_PAYMENT_BLOCK'] = '0'
      expect(() => assertEpsCallAllowed(100_000n)).not.toThrow()
    })

    it('allows priced calls when env var has any non-"1" value', () => {
      for (const value of ['', 'true', 'false', 'on', '2']) {
        process.env['STAGING_PAYMENT_BLOCK'] = value
        expect(() => assertEpsCallAllowed(100_000n)).not.toThrow()
      }
    })
  })

  describe('assertEpsCallAllowed — input validation', () => {
    it('rejects non-bigint totalPaisa (defence against type-coerced caller bugs)', () => {
      // @ts-expect-error: deliberately passing a non-bigint
      expect(() => assertEpsCallAllowed(100)).toThrow(TypeError)
      // @ts-expect-error
      expect(() => assertEpsCallAllowed('100')).toThrow(TypeError)
      // @ts-expect-error
      expect(() => assertEpsCallAllowed(null)).toThrow(TypeError)
      // @ts-expect-error
      expect(() => assertEpsCallAllowed(undefined)).toThrow(TypeError)
    })

    it('TypeError fires regardless of block state', () => {
      delete process.env['STAGING_PAYMENT_BLOCK']
      // @ts-expect-error
      expect(() => assertEpsCallAllowed(100)).toThrow(TypeError)
    })

    it('negative paisa allowed (negative is invalid but not greater-than-zero)', () => {
      // The guard's job is "refuse priced orders," not "validate input."
      // Fee calculator validates negatives; this module stays focused.
      process.env['STAGING_PAYMENT_BLOCK'] = '1'
      expect(() => assertEpsCallAllowed(-1n)).not.toThrow()
    })
  })
})

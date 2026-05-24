/**
 * EPS status normalisation — exhaustive alias × field-location coverage.
 *
 * 8 aliases × 6 field-location permutations × case variants. The
 * test matrix here is the load-bearing regression surface for the
 * §11.4 gotcha — if a future EPS V5 docs revision or real-traffic
 * sample introduces a new alias, the test that fails first should
 * point exactly at the missing case.
 */

import { describe, expect, it } from 'vitest'

import { normaliseStatus, type EpsStatus } from './normalise-status.js'

const ALIASES: Array<[string, EpsStatus]> = [
  ['SUCCESS', 'success'],
  ['COMPLETED', 'success'],
  ['FAILED', 'failed'],
  ['FAILURE', 'failed'],
  ['CANCEL', 'cancelled'],
  ['CANCELLED', 'cancelled'],
  ['CANCELED', 'cancelled'],
  ['PENDING', 'pending'],
]

const FIELD_NAMES = ['Status', 'transactionStatus', 'status'] as const

describe('normaliseStatus — alias coverage', () => {
  for (const [alias, expected] of ALIASES) {
    for (const field of FIELD_NAMES) {
      it(`maps top-level ${field}=${alias} → ${expected}`, () => {
        expect(normaliseStatus({ [field]: alias })).toBe(expected)
      })

      it(`maps nested data.${field}=${alias} → ${expected}`, () => {
        expect(normaliseStatus({ data: { [field]: alias } })).toBe(expected)
      })
    }
  }
})

describe('normaliseStatus — case insensitivity', () => {
  it('matches lowercase alias', () => {
    expect(normaliseStatus({ Status: 'success' })).toBe('success')
    expect(normaliseStatus({ Status: 'completed' })).toBe('success')
    expect(normaliseStatus({ Status: 'failed' })).toBe('failed')
    expect(normaliseStatus({ Status: 'pending' })).toBe('pending')
  })

  it('matches mixed-case alias', () => {
    expect(normaliseStatus({ Status: 'Success' })).toBe('success')
    expect(normaliseStatus({ Status: 'Completed' })).toBe('success')
    expect(normaliseStatus({ Status: 'Pending' })).toBe('pending')
    expect(normaliseStatus({ Status: 'CanCelled' })).toBe('cancelled')
  })
})

describe('normaliseStatus — lookup priority', () => {
  it('top-level wins over nested', () => {
    expect(
      normaliseStatus({
        Status: 'SUCCESS',
        data: { Status: 'FAILED' },
      }),
    ).toBe('success')
  })

  it('within a level, Status wins over transactionStatus wins over status', () => {
    expect(
      normaliseStatus({
        status: 'FAILED',
        transactionStatus: 'CANCELLED',
        Status: 'SUCCESS',
      }),
    ).toBe('success')

    expect(
      normaliseStatus({
        status: 'FAILED',
        transactionStatus: 'SUCCESS',
      }),
    ).toBe('success')
  })

  it('falls back to nested when top-level has no recognised status field', () => {
    expect(
      normaliseStatus({
        someOtherField: 'irrelevant',
        data: { Status: 'PENDING' },
      }),
    ).toBe('pending')
  })
})

describe('normaliseStatus — unknown handling (failure-closed)', () => {
  it('returns "unknown" for null/undefined response', () => {
    expect(normaliseStatus(null)).toBe('unknown')
    expect(normaliseStatus(undefined)).toBe('unknown')
  })

  it('returns "unknown" for non-object response', () => {
    expect(normaliseStatus('SUCCESS')).toBe('unknown') // a literal string is NOT a response object
    expect(normaliseStatus(42)).toBe('unknown')
    expect(normaliseStatus(true)).toBe('unknown')
  })

  it('returns "unknown" when no status field is present', () => {
    expect(normaliseStatus({})).toBe('unknown')
    expect(normaliseStatus({ data: {} })).toBe('unknown')
    expect(normaliseStatus({ otherField: 'value' })).toBe('unknown')
  })

  it('returns "unknown" for unrecognised alias values', () => {
    expect(normaliseStatus({ Status: 'WHATEVER' })).toBe('unknown')
    expect(normaliseStatus({ Status: 'PROCESSING' })).toBe('unknown')
    expect(normaliseStatus({ Status: 'REFUNDED' })).toBe('unknown')
  })

  it('returns "unknown" for empty string status', () => {
    expect(normaliseStatus({ Status: '' })).toBe('unknown')
    expect(normaliseStatus({ data: { Status: '' } })).toBe('unknown')
  })

  it('returns "unknown" for non-string status field values', () => {
    expect(normaliseStatus({ Status: 1 })).toBe('unknown')
    expect(normaliseStatus({ Status: null })).toBe('unknown')
    expect(normaliseStatus({ Status: { nested: 'SUCCESS' } })).toBe('unknown')
  })

  it('returns "unknown" when data is non-object', () => {
    expect(normaliseStatus({ data: 'SUCCESS' })).toBe('unknown')
    expect(normaliseStatus({ data: null })).toBe('unknown')
    expect(normaliseStatus({ data: 42 })).toBe('unknown')
  })
})

describe('normaliseStatus — realistic EPS response shapes', () => {
  it('handles a Verify API success response (data-wrapped)', () => {
    expect(
      normaliseStatus({
        ResponseCode: '1000',
        ResponseMessage: 'Success',
        data: {
          merchantTransactionId: 'TXN-1234567890',
          EPSTransactionId: 'EPS-7890',
          amount: 100,
          transactionStatus: 'SUCCESS',
          paymentMethod: 'card',
        },
      }),
    ).toBe('success')
  })

  it('handles a Verify API failed response with data.Status alias', () => {
    expect(
      normaliseStatus({
        ResponseCode: '4000',
        ResponseMessage: 'Failed',
        data: {
          merchantTransactionId: 'TXN-FAILED-001',
          Status: 'FAILED',
        },
      }),
    ).toBe('failed')
  })

  it('handles a buyer-cancelled response with top-level Status', () => {
    expect(
      normaliseStatus({
        ResponseCode: '5000',
        Status: 'CANCEL',
      }),
    ).toBe('cancelled')
  })

  it('handles a pending response with mixed-case lower-rank field', () => {
    expect(
      normaliseStatus({
        data: {
          status: 'pending',
        },
      }),
    ).toBe('pending')
  })
})

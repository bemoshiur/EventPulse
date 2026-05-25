/**
 * `merchantTransactionId` mint helper — unit tests.
 *
 * Pure function; no DB, no clock, no random — all injected for
 * determinism. Verifies §11.4 constraints:
 *   - minimum 10 chars
 *   - tenant-segment is alphanumeric + lowercase + truncated to 8
 *   - timestamp + random give enough entropy that 1000 mints
 *     don't collide (birthday-paradox sanity)
 */

import { describe, expect, it } from 'vitest'

import {
  mintMerchantTransactionId,
  mintMerchantTransactionIdPure,
  tenantSlugSegment,
} from './order-id.js'

describe('tenantSlugSegment', () => {
  it.each<[string, string]>([
    ['acmecorp', 'acmecorp'],
    ['Acme-Corp', 'acmecorp'],
    ['ACME CORP 2026!', 'acmecorp'],
    ['a', 'a'],
    ['very-long-tenant-slug-here', 'verylong'],
    ['', 'tenant'],
    ['___', 'tenant'],
    ['12345678901234', '12345678'],
  ])('%s → %s', (input, expected) => {
    expect(tenantSlugSegment(input)).toBe(expected)
  })
})

describe('mintMerchantTransactionIdPure', () => {
  // 8 fixed random bytes for reproducibility — base-36 mapping is
  // deterministic, so output stays stable across runs.
  const fixedRandom = new Uint8Array([0, 35, 5, 12, 17, 200, 99, 7])

  it('produces a deterministic id for fixed inputs', () => {
    const id = mintMerchantTransactionIdPure('acmecorp', 1779672000000, fixedRandom)
    expect(id).toMatch(/^TXN-[0-9a-z]{8}-acmecorp-[0-9a-z]{8}$/)
  })

  it('id is >= 10 chars (§11.4)', () => {
    const id = mintMerchantTransactionIdPure('a', 1779672000000, fixedRandom)
    expect(id.length).toBeGreaterThanOrEqual(10)
  })

  it('throws on insufficient random bytes', () => {
    expect(() => mintMerchantTransactionIdPure('acmecorp', 1, new Uint8Array(7))).toThrow(
      RangeError,
    )
  })

  it('different timestamps produce different ids (same tenant, same random)', () => {
    const a = mintMerchantTransactionIdPure('acmecorp', 1779672000000, fixedRandom)
    const b = mintMerchantTransactionIdPure('acmecorp', 1779672000001, fixedRandom)
    expect(a).not.toBe(b)
  })

  it('different tenants produce different ids', () => {
    const a = mintMerchantTransactionIdPure('alpha', 1779672000000, fixedRandom)
    const b = mintMerchantTransactionIdPure('beta', 1779672000000, fixedRandom)
    expect(a).not.toBe(b)
    expect(a).toContain('-alpha-')
    expect(b).toContain('-beta-')
  })

  it('format: TXN-{timestamp}-{tenantSegment}-{rand8}', () => {
    const id = mintMerchantTransactionIdPure('alpha-co', 1779672000000, fixedRandom)
    const parts = id.split('-')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('TXN')
    expect(parts[1]).toHaveLength(8)
    expect(parts[2]).toBe('alphaco')
    expect(parts[3]).toHaveLength(8)
  })
})

describe('mintMerchantTransactionId (production wrapper)', () => {
  it('1000 sequential mints produce 1000 distinct ids (collision sanity)', () => {
    const set = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      set.add(mintMerchantTransactionId('acmecorp'))
    }
    expect(set.size).toBe(1000)
  })

  it('always satisfies §11.4 minimum length', () => {
    for (let i = 0; i < 50; i++) {
      const id = mintMerchantTransactionId('a')
      expect(id.length).toBeGreaterThanOrEqual(10)
    }
  })
})

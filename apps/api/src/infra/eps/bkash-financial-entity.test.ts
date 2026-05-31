/**
 * bKash FinancialEntity predicate — unit tests.
 *
 * Pure-function tests. Pin the strict v1.0 single-method launch
 * semantics (case-insensitive exact trimmed match against 'bkash')
 * so a future "let's be more permissive" PR has to explicitly change
 * these test expectations — the strict default is load-bearing for
 * honoring the Option 3 product principle (decisions.md 2026-05-31).
 */

import { describe, expect, it } from 'vitest'

import { isBkashFinancialEntity } from './bkash-financial-entity.js'

describe('isBkashFinancialEntity — strict v1.0 launch semantics', () => {
  // ─── Positive cases (must accept) ───────────────────────────────

  it('accepts truth-gate observed casing "bKash"', () => {
    // Phase 1.4 truth-gate Mode A returned FinancialEntity="bKash"
    // (decisions.md 2026-05-30 empirical findings table).
    expect(isBkashFinancialEntity('bKash')).toBe(true)
  })

  it('accepts lowercase "bkash"', () => {
    expect(isBkashFinancialEntity('bkash')).toBe(true)
  })

  it('accepts UPPERCASE "BKASH"', () => {
    expect(isBkashFinancialEntity('BKASH')).toBe(true)
  })

  it('accepts mixed-case "BKash"', () => {
    expect(isBkashFinancialEntity('BKash')).toBe(true)
  })

  it('trims surrounding whitespace', () => {
    expect(isBkashFinancialEntity(' bKash ')).toBe(true)
    expect(isBkashFinancialEntity('  bkash')).toBe(true)
    expect(isBkashFinancialEntity('BKASH   ')).toBe(true)
    expect(isBkashFinancialEntity('\tbKash\n')).toBe(true)
  })

  // ─── Negative cases (must reject — Verify-guard routes to disputed) ─

  it('rejects substring matches — "bKash Wallet" is NOT bKash for v1.0', () => {
    // Future EPS variants like "bKash Wallet" / "bKash QR" / "bKash Merchant"
    // require an explicit code change + operator sign-off; we do NOT
    // accept them implicitly at v1.0.
    expect(isBkashFinancialEntity('bKash Wallet')).toBe(false)
    expect(isBkashFinancialEntity('bKash QR')).toBe(false)
    expect(isBkashFinancialEntity('bKash Merchant')).toBe(false)
  })

  it('rejects other Bangladesh MFS methods (the Phase-3-roadmap names)', () => {
    expect(isBkashFinancialEntity('Nagad')).toBe(false)
    expect(isBkashFinancialEntity('Rocket')).toBe(false)
    expect(isBkashFinancialEntity('Upay')).toBe(false)
  })

  it('rejects card-family methods', () => {
    expect(isBkashFinancialEntity('card')).toBe(false)
    expect(isBkashFinancialEntity('Visa')).toBe(false)
    expect(isBkashFinancialEntity('Mastercard')).toBe(false)
    expect(isBkashFinancialEntity('Amex')).toBe(false)
  })

  it('rejects bank-direct methods', () => {
    expect(isBkashFinancialEntity('BEFTN')).toBe(false)
    expect(isBkashFinancialEntity('Bank Transfer')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isBkashFinancialEntity('')).toBe(false)
    expect(isBkashFinancialEntity('   ')).toBe(false)
  })

  // ─── Fail-closed semantics (Verify-guard treats as "cannot confirm bKash") ─

  it('rejects null (fails closed)', () => {
    expect(isBkashFinancialEntity(null)).toBe(false)
  })

  it('rejects undefined (fails closed)', () => {
    expect(isBkashFinancialEntity(undefined)).toBe(false)
  })

  it('rejects number (fails closed; EPS could theoretically send an ID)', () => {
    expect(isBkashFinancialEntity(1)).toBe(false)
    expect(isBkashFinancialEntity(0)).toBe(false)
  })

  it('rejects boolean (fails closed)', () => {
    expect(isBkashFinancialEntity(true)).toBe(false)
    expect(isBkashFinancialEntity(false)).toBe(false)
  })

  it('rejects object / array (fails closed)', () => {
    expect(isBkashFinancialEntity({ value: 'bKash' })).toBe(false)
    expect(isBkashFinancialEntity(['bKash'])).toBe(false)
  })

  // ─── Determinism ────────────────────────────────────────────────

  it('returns bit-identical results for repeated calls', () => {
    expect(isBkashFinancialEntity('bKash')).toBe(isBkashFinancialEntity('bKash'))
    expect(isBkashFinancialEntity('card')).toBe(isBkashFinancialEntity('card'))
    expect(isBkashFinancialEntity(null)).toBe(isBkashFinancialEntity(null))
  })

  // ─── Adversarial / boundary inputs ──────────────────────────────

  it('rejects strings that contain the canonical inside other content', () => {
    // Belt-and-suspenders on the no-substring-match rule
    expect(isBkashFinancialEntity('not bkash')).toBe(false)
    expect(isBkashFinancialEntity('bkashx')).toBe(false)
    expect(isBkashFinancialEntity('xbkash')).toBe(false)
    expect(isBkashFinancialEntity('bk ash')).toBe(false)
  })

  it('rejects similar-looking but distinct identifiers', () => {
    expect(isBkashFinancialEntity('bcash')).toBe(false)
    expect(isBkashFinancialEntity('bkaash')).toBe(false)
    expect(isBkashFinancialEntity('b-kash')).toBe(false)
  })
})

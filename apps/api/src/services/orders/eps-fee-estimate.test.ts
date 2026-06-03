/**
 * DEFAULT_EPS_FEE_BPS_ESTIMATE — the launch bKash rate value pin.
 *
 * Pure unit test (no DB): asserts the runtime default the order-creation
 * service feeds the fee calculator. This is the one place the *value* is
 * pinned to a literal so a silent drift fails CI. The calculator's
 * arithmetic at this rate is covered in domain/payments/fee-calculator.test.ts.
 *
 * The value moved 175 → 200 on Day 46 after the BDT-102 PRODUCTION bKash
 * smoke measured EPS's fee at 2.04 / 102.00 = exactly 2.0% (200 bps) — higher
 * than the sandbox truth-gate's ~174.27 bps that 175 was derived from. The
 * sandbox figure was never production reality; the prod smoke is the source of
 * truth (decisions.md "EPS RATE CONFIRMED" 2026-06-03 + the operator's
 * 2026-06-04 value confirmation).
 */

import { describe, expect, it } from 'vitest'

import { calculateOrderFees } from '../../domain/payments/fee-calculator.js'
import { DEFAULT_EPS_FEE_BPS_ESTIMATE } from './index.js'

describe('DEFAULT_EPS_FEE_BPS_ESTIMATE — prod-confirmed bKash launch rate', () => {
  it('is 200 bps (production-measured 2.04/102.00 = 2.0%), not the sandbox-derived 175', () => {
    expect(DEFAULT_EPS_FEE_BPS_ESTIMATE).toBe(200)
  })

  it('a Mode-A order at the default charges eps_fee at 2.0% of the capture base (BDT 1,000 face → 20.05)', () => {
    const r = calculateOrderFees({
      ticketSubtotalPaisa: 100_000n,
      platformFeeBps: 25,
      epsFeeBps: DEFAULT_EPS_FEE_BPS_ESTIMATE,
      platformFeeHandling: 'pass_through',
      epsFeeHandling: 'pass_through',
    })
    // capture base = 100_000 + 250 (platform PT); eps_fee = floor(100_250 × 200 / 10_000) = 2005
    expect(r.epsFeePaisa).toBe(2005n)
    expect(r.buyerTotalPaisa).toBe(102_255n)
    expect(r.organiserNetPaisa).toBe(100_000n)
  })
})

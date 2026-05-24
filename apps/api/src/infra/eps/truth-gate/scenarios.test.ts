/**
 * Scenarios sanity — these tests pin the calculator's current output
 * for each of the 4 §14.2 modes. If the fee-calculator is changed
 * post-truth-gate (the legitimate Decision N outcome), these tests
 * fail and the truth-gate scenarios + §14.2 amendment land together
 * in the same PR.
 *
 * If these tests fail BEFORE truth-gate execution, the calculator
 * has drifted from what the truth gate is targeting — investigate.
 */

import { describe, expect, it } from 'vitest'

import { CANONICAL_SCENARIO, TRUTH_GATE_SCENARIOS } from './scenarios.js'

describe('truth-gate scenarios — calculator predictions (pinned per Decision N)', () => {
  it('canonical scenario matches §14.2: BDT 1,000 face + 0.25% platform + 2.5% EPS', () => {
    expect(CANONICAL_SCENARIO.ticketSubtotalPaisa).toBe(100_000n)
    expect(CANONICAL_SCENARIO.platformFeeBps).toBe(25)
    expect(CANONICAL_SCENARIO.epsFeeBps).toBe(250)
  })

  it('all 4 modes present in order A → D', () => {
    expect(TRUTH_GATE_SCENARIOS.map((s) => s.modeId)).toEqual(['A', 'B', 'C', 'D'])
  })

  describe('Mode A (PT, PT) — both fees passed to buyer', () => {
    const mode = TRUTH_GATE_SCENARIOS[0]!
    it('platform_fee = 250 paisa (0.25% × 100,000)', () => {
      expect(mode.calculatorPrediction.platformFeePaisa).toBe(250n)
    })
    it('eps_fee = 2506 paisa (2.5% × (100,000 + 250)) — matches §14.2 primary', () => {
      expect(mode.calculatorPrediction.epsFeePaisa).toBe(2506n)
      expect(mode.spec14_2_primaryEpsFeePaisa).toBe(2506n)
    })
    it('buyer_total = 102,756 paisa (1,027.56 BDT)', () => {
      expect(mode.calculatorPrediction.buyerTotalPaisa).toBe(102_756n)
    })
    it('organiser_net = 100,000 paisa (BDT 1,000 — full face value)', () => {
      expect(mode.calculatorPrediction.organiserNetPaisa).toBe(100_000n)
    })
  })

  describe('Mode B (AB, AB) — both fees absorbed', () => {
    const mode = TRUTH_GATE_SCENARIOS[1]!
    it('eps_fee = 2500 paisa (2.5% × 100,000) — matches §14.2 primary', () => {
      expect(mode.calculatorPrediction.epsFeePaisa).toBe(2500n)
      expect(mode.spec14_2_primaryEpsFeePaisa).toBe(2500n)
    })
    it('buyer_total = 100,000 paisa (subtotal only)', () => {
      expect(mode.calculatorPrediction.buyerTotalPaisa).toBe(100_000n)
    })
    it('organiser_net = 97,250 paisa (subtotal - both fees)', () => {
      expect(mode.calculatorPrediction.organiserNetPaisa).toBe(97_250n)
    })
  })

  describe('Mode C (AB, PT) — THE CELL MOST LIKELY TO SHIFT', () => {
    const mode = TRUTH_GATE_SCENARIOS[2]!
    it('calculator predicts eps_fee = 2500 paisa (2.5% × 100,000)', () => {
      // Calculator's rule: eps_capture_base = subtotal when platform absorbs.
      expect(mode.calculatorPrediction.epsFeePaisa).toBe(2500n)
    })
    it('§14.2 primary says eps_fee = 2506 (matches Mode A primary)', () => {
      expect(mode.spec14_2_primaryEpsFeePaisa).toBe(2506n)
    })
    it('the 6-paisa divergence is the truth-gate target — sandbox will arbitrate', () => {
      const delta = mode.spec14_2_primaryEpsFeePaisa - mode.calculatorPrediction.epsFeePaisa
      expect(delta).toBe(6n)
    })
    it('calculator buyer_total = 102,500 paisa (matches §14.2 parenthetical "or 25.00")', () => {
      expect(mode.calculatorPrediction.buyerTotalPaisa).toBe(102_500n)
    })
    it('organiser_net = 99,750 paisa', () => {
      expect(mode.calculatorPrediction.organiserNetPaisa).toBe(99_750n)
    })
  })

  describe('Mode D (PT, AB) — platform pass-through, EPS absorb', () => {
    const mode = TRUTH_GATE_SCENARIOS[3]!
    it('eps_fee = 2506 paisa (2.5% × 100,250 — EPS fee on the larger capture)', () => {
      expect(mode.calculatorPrediction.epsFeePaisa).toBe(2506n)
      expect(mode.spec14_2_primaryEpsFeePaisa).toBe(2506n)
    })
    it('buyer_total = 100,250 paisa (subtotal + platform_fee)', () => {
      expect(mode.calculatorPrediction.buyerTotalPaisa).toBe(100_250n)
    })
    it('organiser_net = 97,494 paisa (subtotal - eps_fee_on_larger_capture)', () => {
      expect(mode.calculatorPrediction.organiserNetPaisa).toBe(97_494n)
    })
  })
})

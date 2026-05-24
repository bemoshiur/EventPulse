/**
 * Decision N — EPS sandbox truth-gate scenarios.
 *
 * Per `.claude/memory/decisions.md` "Decision N — Fee calculator
 * EPS-base rule locked + mandatory Day 24-25 EPS sandbox truth gate"
 * (2026-05-19), before Day 26+ wires real order creation onto the EPS
 * wrapper, 4 real EPS sandbox transactions MUST be run against the 4
 * §14.2 fee-handling modes. Each transaction's actual EPS-charged
 * fee is compared to the fee-calculator's prediction. Any delta in
 * any cell is a CALCULATOR BUG — the calculator is the variable to
 * change, never the sandbox observation.
 *
 * This module is PURE DATA + PURE DERIVATION. It defines:
 *
 *   1. The canonical §14.2 worked-example scenario (BDT 1,000 face +
 *      0.25% platform + 2.5% EPS) — same numbers the calculator was
 *      built against.
 *   2. The 4 mode combinations (PT,PT) / (AB,AB) / (AB,PT) / (PT,AB).
 *   3. For each mode, the calculator-derived expected prediction.
 *   4. For each mode, the §14.2 PRIMARY narrative numbers (Mode A,
 *      B, D match; Mode C diverges per Decision N — primary says
 *      eps_fee=2506, calculator says 2500).
 *
 * The harness in `./harness.ts` consumes these scenarios; the script
 * in `./run-truth-gate.ts` drives the harness against a real EPS
 * observation provider (live at Day 24-25 execution time, gated on
 * Moshiur supplying EPS sandbox credentials + tax-withholding opinion).
 *
 * Why this lives as static data even though the calculator could
 * compute it on demand: pinning the §14.2 worked-example numbers as
 * literal constants here means a future calculator change that drifts
 * from §14.2 fails the cross-check in scenarios.test.ts immediately,
 * not at truth-gate-execution time when the cost of discovering the
 * drift is much higher (live sandbox transactions burned).
 */

import { calculateOrderFees, type FeeCalcResult } from '../../../domain/payments/fee-calculator.js'

export type ModeId = 'A' | 'B' | 'C' | 'D'

/**
 * The canonical §14.2 worked-example inputs. BDT 1,000 ticket face +
 * 0.25% platform fee (25 bps) + 2.5% EPS fee (250 bps). All bigint
 * paisa per the fee-calculator contract.
 */
export const CANONICAL_SCENARIO = {
  ticketSubtotalPaisa: 100_000n, // BDT 1,000.00 face
  platformFeeBps: 25, // 0.25%
  epsFeeBps: 250, // 2.5%
} as const

export interface TruthGateScenario {
  modeId: ModeId
  /** Human label: "PT,PT" / "AB,AB" / "AB,PT" / "PT,AB" */
  modeLabel: string
  description: string
  platformFeeHandling: 'absorb' | 'pass_through'
  epsFeeHandling: 'absorb' | 'pass_through'
  /** What the §14.2 primary narrative says EPS will charge (for cross-reference; Mode C diverges per Decision N). */
  spec14_2_primaryEpsFeePaisa: bigint
  /** What the fee-calculator predicts (the value the harness asserts against). */
  calculatorPrediction: FeeCalcResult
}

function buildScenario(
  modeId: ModeId,
  modeLabel: string,
  description: string,
  platformFeeHandling: 'absorb' | 'pass_through',
  epsFeeHandling: 'absorb' | 'pass_through',
  spec14_2_primaryEpsFeePaisa: bigint,
): TruthGateScenario {
  const calculatorPrediction = calculateOrderFees({
    ticketSubtotalPaisa: CANONICAL_SCENARIO.ticketSubtotalPaisa,
    platformFeeBps: CANONICAL_SCENARIO.platformFeeBps,
    epsFeeBps: CANONICAL_SCENARIO.epsFeeBps,
    platformFeeHandling,
    epsFeeHandling,
  })
  return {
    modeId,
    modeLabel,
    description,
    platformFeeHandling,
    epsFeeHandling,
    spec14_2_primaryEpsFeePaisa,
    calculatorPrediction,
  }
}

/**
 * The 4 §14.2 scenarios. Order matches §14.2 narrative (Modes A → D).
 *
 * - **Mode A (PT, PT)** — both fees passed to buyer. Buyer pays
 *   subtotal + platform_fee + eps_fee. §14.2 primary eps_fee=2506.
 *   Calculator prediction: matches.
 * - **Mode B (AB, AB)** — both fees absorbed. Buyer pays subtotal
 *   only. §14.2 primary eps_fee=2500. Calculator: matches.
 * - **Mode C (AB, PT)** — platform absorb, EPS pass-through. §14.2
 *   primary eps_fee=2506; calculator says 2500. **THE CELL MOST
 *   LIKELY TO SHIFT** per Decision N. Truth-gate execution will
 *   determine which is right.
 * - **Mode D (PT, AB)** — platform pass-through, EPS absorb. §14.2
 *   primary eps_fee=2506. Calculator: matches.
 */
export const TRUTH_GATE_SCENARIOS: ReadonlyArray<TruthGateScenario> = [
  buildScenario(
    'A',
    'PT,PT',
    'Both fees passed to buyer (most transparent for organiser)',
    'pass_through',
    'pass_through',
    2506n,
  ),
  buildScenario(
    'B',
    'AB,AB',
    'Both fees absorbed by organiser (cleanest UX for buyer)',
    'absorb',
    'absorb',
    2500n,
  ),
  buildScenario(
    'C',
    'AB,PT',
    'Platform absorb, EPS pass-through — MOST LIKELY CELL TO SHIFT',
    'absorb',
    'pass_through',
    2506n, // §14.2 PRIMARY; calculator says 2500. Decision N pending sandbox truth.
  ),
  buildScenario('D', 'PT,AB', 'Platform pass-through, EPS absorb', 'pass_through', 'absorb', 2506n),
]

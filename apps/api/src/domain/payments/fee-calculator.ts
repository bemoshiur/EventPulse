/**
 * Event Pulse — money math, single source of truth.
 *
 * The §1.3 R2 "money never lies" rule + §14.3 "fee calculator as the single
 * source of truth" combine into one load-bearing constraint: every paisa
 * amount the platform charges, retains, settles, or refunds MUST be derived
 * from this function. No fee math anywhere else in the codebase.
 *
 * Per §14.2, four fee-handling modes are supported:
 *
 *   - (pass_through, pass_through) — buyer eats both fees; organiser net = subtotal
 *   - (absorb, absorb)             — organiser eats both fees; buyer pays subtotal only
 *   - (absorb, pass_through)       — organiser eats platform; buyer eats eps
 *   - (pass_through, absorb)       — buyer eats platform; organiser eats eps
 *
 * All four are exercised in the test suite alongside §14.2's worked examples.
 *
 * Bigint paisa is the canonical money type per §1.3 R2 — never float, never
 * decimal columns, never Number. Integer paisa division truncates toward
 * zero (which is floor for the non-negative paisa values this function
 * accepts), matching the "we round down at paisa level on the buyer side"
 * convention §14.2 displays.
 *
 * Determinism guarantees (no I/O):
 *   - no Date.now(), no random, no fetch, no DB
 *   - same input → bit-identical output
 *   - safe to call inside transactions, inside tests, inside snapshot fixtures
 *
 * AIT withholding (§29 #9) + Mushak/VAT (§29 #10) are deliberately NOT
 * computed here. Per §29 both are OPEN pending legal opinion. The
 * settlement engine (Sprint 3 Day 26+ for the order pipeline; the
 * scheduled-batch engine itself lands in Sprint 7+ per §26.2) will deduct
 * AIT from `organiserNetPaisa` once the classification is resolved. The
 * `organiser_net` value returned by this function is therefore PRE-WITHHOLDING.
 * Wiring withholding into the function would require a stable answer to
 * §29 #9 that doesn't exist yet — and shipping the wrong AIT classification
 * is worse than reserving the slot until counsel returns.
 *
 * Per CLAUDE.md §24.3 "Required tests per feature" + §14.3 "12+ unit tests
 * covering every combination", the test file at
 * apps/api/src/domain/payments/fee-calculator.test.ts exercises:
 *
 *   1. Each of the four §14.2 worked examples (BDT 1,000 face + 0.25% platform + 2.5% eps)
 *   2. Free-event (subtotal=0) — all output fields = 0
 *   3. 1-paisa subtotal — bps × 1 / 10000 floors to 0
 *   4. Very large subtotal — bigint arithmetic doesn't overflow
 *   5. Per-tenant override fee_bps — different platform fee % flows end-to-end
 *   6. Invalid inputs (negative subtotal, non-integer bps, bps > 10000, etc.) — throw
 *   7. Determinism — same input → bit-identical result twice in a row
 *
 * §14.3 references the function as `calculateFees`; we ship it as
 * `calculateOrderFees` (per Day 21 brief) and re-export `calculateFees`
 * as a §14.3-literal alias for any future references that grep against
 * the spec name. The two names point at the same function.
 */

/**
 * Fee-handling literal — `absorb` means the side eats the fee; `pass_through`
 * means it's added to the buyer's total as a separate line item.
 */
export type FeeHandling = 'absorb' | 'pass_through'

/**
 * Input shape — matches §14.3 spec verbatim. All paisa amounts are bigint.
 * Bps values are plain `number` (0..10000) since they're small integers.
 */
export interface FeeCalcInput {
  /** Ticket face total in paisa — sum of (tier price × quantity) post any coupon. */
  ticketSubtotalPaisa: bigint
  /** Platform fee in basis points; e.g. 25 = 0.25%. From `tenant_fee_config`. */
  platformFeeBps: number
  /**
   * EPS fee in basis points; e.g. 250 = 2.5%. Estimated from payment method
   * pre-checkout, OR set from EPS settlement report post-payment. The
   * function is method-agnostic — caller is responsible for sourcing the
   * right bps for the relevant context.
   */
  epsFeeBps: number
  /** How the platform fee is treated relative to the buyer. */
  platformFeeHandling: FeeHandling
  /** How the EPS fee is treated relative to the buyer. */
  epsFeeHandling: FeeHandling
}

/**
 * One row of the buyer-facing receipt breakdown. Only lines the buyer
 * actually sees appear here; settlement-side splits live on the result's
 * top-level fields (`organiserNetPaisa`, `platformRevenuePaisa`).
 */
export interface BreakdownLine {
  label: 'ticket_subtotal' | 'platform_fee' | 'eps_fee'
  amountPaisa: bigint
}

/**
 * Output shape — matches §14.3 spec verbatim. All paisa amounts are bigint.
 */
export interface FeeCalcResult {
  /** Ticket face total — echoes the input for downstream consumers. */
  subtotalPaisa: bigint
  /** Platform fee — always computed on subtotal regardless of handling. */
  platformFeePaisa: bigint
  /**
   * EPS fee — computed on what EPS actually captures (= buyer-side capture
   * base, which includes platform_fee if it's pass-through, excludes it if
   * absorbed). Mode D's "EPS fee on the larger captured amount" gotcha
   * (§14.2) is the canonical reason this differs from "always on subtotal".
   */
  epsFeePaisa: bigint
  /** Total amount the buyer pays at checkout. */
  buyerTotalPaisa: bigint
  /** What the organiser receives at settlement (PRE-WITHHOLDING — see header). */
  organiserNetPaisa: bigint
  /** What the platform retains (= the platform fee, regardless of handling). */
  platformRevenuePaisa: bigint
  /** Buyer-facing line items for receipt rendering. */
  breakdown: BreakdownLine[]
}

/**
 * Thrown when the caller passes a value that violates the function's
 * invariants. The fee calculator is the single source of truth for money
 * math; rejecting bad input here is strictly preferable to silently
 * producing wrong numbers downstream.
 */
export class InvalidFeeCalcInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidFeeCalcInputError'
  }
}

const BPS_DIVISOR = 10_000n // 100% in basis points
const MAX_BPS = 10_000 // 100% inclusive — above this, the math becomes negative or undefined

/**
 * Compute platform_fee_paisa from subtotal + bps. Pure integer math, floor
 * via bigint truncation. Returns 0n when bps=0 OR subtotal=0.
 */
function feeOnAmount(amountPaisa: bigint, bps: number): bigint {
  return (amountPaisa * BigInt(bps)) / BPS_DIVISOR
}

/**
 * Compute order fees deterministically per §14.3.
 *
 * @throws {InvalidFeeCalcInputError} on negative subtotal, non-integer bps,
 *   bps out of [0, 10000], or unsupported handling literal.
 */
export function calculateOrderFees(input: FeeCalcInput): FeeCalcResult {
  validateInput(input)

  const { ticketSubtotalPaisa, platformFeeBps, epsFeeBps, platformFeeHandling, epsFeeHandling } =
    input

  // Platform fee is always computed on the face-value subtotal — the platform
  // takes its cut from the ticket price, not from any post-fee amount. This
  // matches §14.2 Mode B where the absorbed platform fee is 2.50 BDT (0.25%
  // of 1,000.00) regardless of EPS handling.
  const platformFeePaisa = feeOnAmount(ticketSubtotalPaisa, platformFeeBps)

  // EPS fee is computed on the amount EPS actually captures from the buyer.
  // When platform fee is pass-through, the capture includes it (so EPS
  // charges on a larger base — Mode A + Mode D §14.2 footnote). When platform
  // fee is absorbed, the capture is just the ticket subtotal (Mode B + C).
  const epsCaptureBasePaisa =
    platformFeeHandling === 'pass_through'
      ? ticketSubtotalPaisa + platformFeePaisa
      : ticketSubtotalPaisa
  const epsFeePaisa = feeOnAmount(epsCaptureBasePaisa, epsFeeBps)

  // Buyer total = subtotal + whichever fees are passed through. Free events
  // (subtotal=0) yield buyer_total=0 regardless of handling because both
  // fees are 0 when bps × 0 = 0.
  const buyerTotalPaisa =
    ticketSubtotalPaisa +
    (platformFeeHandling === 'pass_through' ? platformFeePaisa : 0n) +
    (epsFeeHandling === 'pass_through' ? epsFeePaisa : 0n)

  // Organiser net = subtotal minus whichever fees are absorbed. Mode A:
  // organiser_net = subtotal (both passed through). Mode B: organiser_net
  // = subtotal - both fees. Mode C: subtotal - platform_fee. Mode D:
  // subtotal - eps_fee. Pre-withholding per the header.
  const organiserNetPaisa =
    ticketSubtotalPaisa -
    (platformFeeHandling === 'absorb' ? platformFeePaisa : 0n) -
    (epsFeeHandling === 'absorb' ? epsFeePaisa : 0n)

  // Platform revenue = platform fee, regardless of handling. The handling
  // mode only affects who paid the fee at the buyer-facing layer; the fee
  // accrues to platform either way.
  const platformRevenuePaisa = platformFeePaisa

  // Buyer-facing receipt breakdown — only lines the buyer actually sees,
  // and only ones with a non-zero amount. Free events (subtotal=0 per §13.5)
  // yield an EMPTY breakdown array so receipt renderers don't have to
  // independently filter "Ticket — 0.00 BDT" lines. When subtotal > 0,
  // the ticket line always leads so renderers see a predictable order
  // regardless of fee mode.
  const breakdown: BreakdownLine[] = []
  if (ticketSubtotalPaisa > 0n) {
    breakdown.push({ label: 'ticket_subtotal', amountPaisa: ticketSubtotalPaisa })
  }
  if (platformFeeHandling === 'pass_through' && platformFeePaisa > 0n) {
    breakdown.push({ label: 'platform_fee', amountPaisa: platformFeePaisa })
  }
  if (epsFeeHandling === 'pass_through' && epsFeePaisa > 0n) {
    breakdown.push({ label: 'eps_fee', amountPaisa: epsFeePaisa })
  }

  return {
    subtotalPaisa: ticketSubtotalPaisa,
    platformFeePaisa,
    epsFeePaisa,
    buyerTotalPaisa,
    organiserNetPaisa,
    platformRevenuePaisa,
    breakdown,
  }
}

/**
 * §14.3-literal alias. The spec names the function `calculateFees`; we ship
 * it as `calculateOrderFees` per the Day 21 brief. Both names point at the
 * same implementation; downstream code may import whichever reads better
 * in its call site.
 */
export const calculateFees = calculateOrderFees

function validateInput(input: FeeCalcInput): void {
  if (typeof input.ticketSubtotalPaisa !== 'bigint') {
    throw new InvalidFeeCalcInputError(
      `ticketSubtotalPaisa must be a bigint; received ${typeof input.ticketSubtotalPaisa}`,
    )
  }
  if (input.ticketSubtotalPaisa < 0n) {
    throw new InvalidFeeCalcInputError(
      `ticketSubtotalPaisa must be >= 0; received ${input.ticketSubtotalPaisa}`,
    )
  }
  validateBps('platformFeeBps', input.platformFeeBps)
  validateBps('epsFeeBps', input.epsFeeBps)
  if (input.platformFeeHandling !== 'absorb' && input.platformFeeHandling !== 'pass_through') {
    throw new InvalidFeeCalcInputError(
      `platformFeeHandling must be 'absorb' | 'pass_through'; received ${String(input.platformFeeHandling)}`,
    )
  }
  if (input.epsFeeHandling !== 'absorb' && input.epsFeeHandling !== 'pass_through') {
    throw new InvalidFeeCalcInputError(
      `epsFeeHandling must be 'absorb' | 'pass_through'; received ${String(input.epsFeeHandling)}`,
    )
  }
}

function validateBps(field: string, bps: number): void {
  if (typeof bps !== 'number') {
    throw new InvalidFeeCalcInputError(`${field} must be a number; received ${typeof bps}`)
  }
  // Finite check before integer check so the error message for NaN / Infinity
  // says "must be a finite number" instead of the misleading "must be an
  // integer" — Number.isInteger() returns false for both Infinity and NaN,
  // but they're not non-integer floats, they're non-finite. Clearer diagnostics
  // matter when the fee calculator is the single source of money truth.
  if (!Number.isFinite(bps)) {
    throw new InvalidFeeCalcInputError(`${field} must be a finite number; received ${bps}`)
  }
  if (!Number.isInteger(bps)) {
    throw new InvalidFeeCalcInputError(`${field} must be an integer; received ${bps}`)
  }
  if (bps < 0) {
    throw new InvalidFeeCalcInputError(`${field} must be >= 0; received ${bps}`)
  }
  if (bps > MAX_BPS) {
    throw new InvalidFeeCalcInputError(`${field} must be <= ${MAX_BPS} (100%); received ${bps}`)
  }
}

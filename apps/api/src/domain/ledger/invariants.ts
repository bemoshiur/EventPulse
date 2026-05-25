/**
 * §14.10 Ledger Integrity — the money-conservation invariants.
 *
 * Sprint 3 Day 30 Phase 2.
 *
 * ════════════════════════════════════════════════════════════════════
 * What §14.10 says verbatim
 * ════════════════════════════════════════════════════════════════════
 *
 * "Two invariants enforced by reconciliation job that runs after every
 * batch:
 *
 *   - Invariant 1: Σ order.total_paisa = Σ (order.net_to_organiser_paisa
 *     + order.platform_fee_paisa + order.eps_fee_paisa +
 *     order.withholding_tax_paisa) for every order in the batch.
 *
 *   - Invariant 2: Σ disbursement_batch.gross_paisa − refunds −
 *     withholding = Σ disbursement_batch.net_paisa for every batch in
 *     any time window.
 *
 *   Any violation halts new batch creation and pages the on-call."
 *
 * ════════════════════════════════════════════════════════════════════
 * Module structure
 * ════════════════════════════════════════════════════════════════════
 *
 *   - PURE FUNCTIONS over row arrays — deterministic, side-effect-free,
 *     property-testable. No DB, no I/O. This is the §14.3-style
 *     "single source of truth" discipline applied to the verifier.
 *   - DB-BACKED VERIFIERS wrap the pure functions with the queries
 *     that load real data. These are what the future reconciliation
 *     cron + the Day-30 DB-gated test invoke.
 *   - Per-row interpretation: §14.10 says "for every order" — the
 *     invariant holds AT THE ROW LEVEL (not just in aggregate). Both
 *     interpretations are equivalent for the same dataset, but
 *     per-row is the stronger surface: it pinpoints which order
 *     violates so the on-call can investigate the specific row.
 *
 * ════════════════════════════════════════════════════════════════════
 * Invariant 2 status (Sprint 3)
 * ════════════════════════════════════════════════════════════════════
 *
 * `disbursement_batches` does NOT exist in the Sprint 3 schema —
 * settlement batches land Sprint 7 per §26.2. Invariant 2's PURE
 * function is shipped today (so the verifier surface is complete +
 * unit-testable against fixture data) but the DB-backed Invariant 2
 * verifier is intentionally a no-op / "no batches to check" until the
 * batches table lands. When it does, the verifier wires in trivially
 * at the same seam.
 *
 * ════════════════════════════════════════════════════════════════════
 * Bigint paisa — exact equality (no rounding slop)
 * ════════════════════════════════════════════════════════════════════
 *
 * Per §1.3 R2 "money never lies": every paisa amount is bigint. The
 * invariant check is BIT-EXACT — no tolerance, no rounding. A single
 * paisa discrepancy is a real money bug and the verifier surfaces it.
 */

/**
 * Shape needed for §14.10 Invariant 1. A subset of the `orders`
 * schema fields. Defined locally so the pure function can be unit-
 * tested without importing the Drizzle schema.
 */
export interface LedgerOrderRow {
  id: string
  totalPaisa: bigint
  netToOrganiserPaisa: bigint
  platformFeePaisa: bigint
  epsFeePaisa: bigint
  withholdingTaxPaisa: bigint
}

/**
 * Shape needed for §14.10 Invariant 2. Mirrors the `disbursement_batches`
 * schema (Sprint 7+ per §26.2). Defined locally for the same reasons.
 *
 * The `withholding` + `refunds` in §14.10's Invariant 2 expression are
 * subtracted from gross; the result must equal net. Same bit-exact
 * equality as Invariant 1.
 */
export interface LedgerBatchRow {
  id: string
  grossPaisa: bigint
  refundsPaisa: bigint
  withholdingTaxPaisa: bigint
  netPaisa: bigint
}

/**
 * A single violation report. The pure functions return arrays of
 * these (empty = no violations). Callers can either `throw new
 * LedgerInvariantViolation(violations)` to halt the calling op, or
 * page on-call + persist for triage.
 *
 * `diff = expected − actual`. Positive diff means the DB row UNDER-
 * states the split (or OVER-states the total); negative diff means
 * the DB row OVER-states the split. Either direction is a real bug.
 */
export interface LedgerInvariantViolation {
  invariant: 'invariant_1_per_order_money_split' | 'invariant_2_batch_reconciliation'
  rowId: string
  expected: bigint
  actual: bigint
  diff: bigint
}

/**
 * Typed error thrown by the convenience `assert*` helpers. Carries
 * the full violation list so the caller can log every offending row,
 * not just the first.
 */
export class LedgerInvariantError extends Error {
  public readonly violations: LedgerInvariantViolation[]
  constructor(violations: LedgerInvariantViolation[]) {
    const summary = violations
      .map(
        (v) =>
          `${v.invariant}@${v.rowId}: expected=${v.expected}p actual=${v.actual}p diff=${v.diff}p`,
      )
      .join('; ')
    super(`§14.10 ledger invariant violation(s): ${summary}`)
    this.name = 'LedgerInvariantError'
    this.violations = violations
  }
}

/**
 * §14.10 Invariant 1 — per-order money conservation.
 *
 * For every order row: `total_paisa MUST equal net_to_organiser_paisa
 * + platform_fee_paisa + eps_fee_paisa + withholding_tax_paisa`. Bit-
 * exact. No tolerance.
 *
 * Returns the list of violations (empty array = invariant holds for
 * every row). Pure: no I/O, deterministic, safe in tests + tx.
 */
export function checkInvariant1PerOrder(
  rows: ReadonlyArray<LedgerOrderRow>,
): LedgerInvariantViolation[] {
  const violations: LedgerInvariantViolation[] = []
  for (const row of rows) {
    const split =
      row.netToOrganiserPaisa + row.platformFeePaisa + row.epsFeePaisa + row.withholdingTaxPaisa
    if (row.totalPaisa !== split) {
      violations.push({
        invariant: 'invariant_1_per_order_money_split',
        rowId: row.id,
        expected: split,
        actual: row.totalPaisa,
        diff: split - row.totalPaisa,
      })
    }
  }
  return violations
}

/**
 * §14.10 Invariant 2 — per-batch reconciliation.
 *
 * For every batch row: `gross_paisa − refunds_paisa −
 * withholding_tax_paisa MUST equal net_paisa`. Bit-exact.
 *
 * Pure. `disbursement_batches` doesn't exist in Sprint 3; this
 * function ships today against fixture data + wires into the DB
 * verifier when the schema lands Sprint 7.
 */
export function checkInvariant2PerBatch(
  rows: ReadonlyArray<LedgerBatchRow>,
): LedgerInvariantViolation[] {
  const violations: LedgerInvariantViolation[] = []
  for (const row of rows) {
    const expectedNet = row.grossPaisa - row.refundsPaisa - row.withholdingTaxPaisa
    if (row.netPaisa !== expectedNet) {
      violations.push({
        invariant: 'invariant_2_batch_reconciliation',
        rowId: row.id,
        expected: expectedNet,
        actual: row.netPaisa,
        diff: expectedNet - row.netPaisa,
      })
    }
  }
  return violations
}

/**
 * Convenience: throw on any violation. Use this when the calling code
 * wants halt-on-mismatch semantics (matches §14.10 "any violation
 * halts new batch creation").
 */
export function assertInvariant1PerOrder(rows: ReadonlyArray<LedgerOrderRow>): void {
  const violations = checkInvariant1PerOrder(rows)
  if (violations.length > 0) throw new LedgerInvariantError(violations)
}

export function assertInvariant2PerBatch(rows: ReadonlyArray<LedgerBatchRow>): void {
  const violations = checkInvariant2PerBatch(rows)
  if (violations.length > 0) throw new LedgerInvariantError(violations)
}

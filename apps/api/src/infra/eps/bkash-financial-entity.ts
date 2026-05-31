/**
 * bKash FinancialEntity predicate — Day 38 Phase 2 (Option 3 v1.0
 * single-method launch).
 *
 * Per `.claude/memory/decisions.md` "EPS fee-model structural decision —
 * Option 3 (single-method launch, bKash-only for v1.0) CHOSEN"
 * (2026-05-31): at launch, EPS hosted checkout's
 * `FinancialEntity` Verify-response field MUST be 'bKash'. Any other
 * value (card, Nagad, Rocket, Upay, bank, etc.) indicates a buyer who
 * deviated from the bKash-only single-method launch constraint on
 * EPS's hosted checkout page. The settlement service diverts these
 * orders to `disputed` status via the Day 38 Phase 2 mechanism (d)
 * Verify-guard pattern; this module is the single source of truth
 * for "is this string a bKash identifier".
 *
 * **Match semantics (Day 38 sub-decision B answered by operator):**
 * exact case-insensitive trimmed match against the literal `'bkash'`.
 * The truth-gate empirical observation (Phase 1.4 sandbox run,
 * `decisions.md` 2026-05-30) saw `FinancialEntity: "bKash"` (mixed
 * case). Lowercase + trim catches any of: `bKash`, `BKASH`, `bkash`,
 * ` bKash `, `BKash`. Substring matches (`bKash Wallet` / future EPS
 * variants) are NOT accepted at v1.0 — adding a new variant requires
 * an explicit code change + operator sign-off.
 *
 * **Null / missing handling:** `null`, `undefined`, empty string, and
 * any non-string input return `false`. The Verify-guard treats these
 * as "we cannot confirm bKash" and routes to dispute. A future EPS
 * response shape that drops `FinancialEntity` entirely would fail
 * closed — the strictest reasonable default.
 *
 * **No I/O. Deterministic.** Same input → bit-identical output. Safe
 * to call inside transactions, tests, snapshots.
 *
 * Pinned in tests so a future "let's be more permissive" PR has to
 * explicitly change the test expectations — the strict default is
 * load-bearing for honoring the Option 3 product principle.
 *
 * Post-launch expansion: when card / Nagad / Rocket / Upay etc. land
 * in Phase 2/3 of the post-launch roadmap (per decisions.md 2026-05-31
 * Option 3 entry implication (d)), a separate
 * `isAcceptedFinancialEntity(value, allowedMethods)` predicate
 * supersedes this; this single-method predicate remains as the v1.0
 * archaeology pointer.
 */

/**
 * The canonical bKash identifier — the value EPS publishes in the
 * Verify response's `FinancialEntity` field for bKash payments.
 * Captured from the Phase 1.4 truth-gate Mode A observation
 * (decisions.md 2026-05-30 empirical findings table).
 */
const BKASH_CANONICAL = 'bkash' as const

/**
 * Returns true iff `value` is a string that, after trimming and
 * lowercasing, equals the canonical bKash identifier `'bkash'`.
 *
 * Pure function: no I/O, no globals, no Date, no Math.random. Same
 * input → bit-identical output. Safe in transactions and tests.
 *
 * Examples (pinned in tests):
 *   isBkashFinancialEntity('bKash')      → true   (truth-gate observed casing)
 *   isBkashFinancialEntity('bkash')      → true
 *   isBkashFinancialEntity('BKASH')      → true
 *   isBkashFinancialEntity(' bKash ')    → true   (trimmed)
 *   isBkashFinancialEntity('bKash Wallet') → false (no substring match)
 *   isBkashFinancialEntity('card')       → false
 *   isBkashFinancialEntity('Nagad')      → false
 *   isBkashFinancialEntity('')           → false
 *   isBkashFinancialEntity(null)         → false  (fail closed)
 *   isBkashFinancialEntity(undefined)    → false  (fail closed)
 *   isBkashFinancialEntity(42)           → false  (fail closed)
 *
 * Fails closed on null / missing / non-string input — the Verify-guard
 * uses this to gate the awaiting_payment→paid transition; a missing
 * field must NOT be treated as "probably bKash, let's allow it".
 */
export function isBkashFinancialEntity(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return value.trim().toLowerCase() === BKASH_CANONICAL
}

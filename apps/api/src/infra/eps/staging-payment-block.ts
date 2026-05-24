/**
 * STAGING_PAYMENT_BLOCK guard — refuses priced EPS calls when the
 * staging environment carries production EPS credentials per the Day 20
 * decision ("EPS production credentials intentionally used in staging").
 *
 * Per CLAUDE.md §11.0:
 *
 *   "the in-house wrapper MUST enforce STAGING_PAYMENT_BLOCK=1 as a hard
 *    gate refusing any initialisation request with total_paisa > 0"
 *
 * Semantics:
 *   - STAGING_PAYMENT_BLOCK === '1' AND totalPaisa > 0n → throw
 *   - STAGING_PAYMENT_BLOCK !== '1'                     → allow
 *   - STAGING_PAYMENT_BLOCK === '1' AND totalPaisa === 0n → allow (free events;
 *     §13.5 says free events don't call EPS at all, but defence in depth)
 *
 * The string literal `'1'` is the canonical "on" value; any other value
 * (including `'true'`, `'yes'`, `'on'`, `'TRUE'`) is treated as off.
 * Bootstrap-staging.sh writes `STAGING_PAYMENT_BLOCK=1` verbatim per
 * the §11.3 env var spec.
 *
 * This module is intentionally side-effect free at import time — no env
 * snapshot on module load, no class-level state. The check reads
 * `process.env` at call time so PM2 reloads with updated env values
 * take effect without process restart.
 *
 * Lifecycle: this guard exists for the entire staging lifetime. Removing
 * it requires:
 *   1. A new `.claude/memory/decisions.md` entry explicitly authorising
 *      MVP production cutover.
 *   2. The cutover event itself (staging EC2 retired or repurposed).
 *   3. `STAGING_PAYMENT_BLOCK` env var deleted from
 *      `infra/scripts/bootstrap-staging.sh` in the same PR.
 *
 * Any earlier removal — including "just for this test" — is a STOP-ASK.
 */

/**
 * Thrown when the guard refuses a priced order. Greppable; carries the
 * total paisa for context; never includes the order id or any other
 * potentially-sensitive context (per §1.3 R5 "no PII in logs").
 */
export class StagingPaymentBlockedError extends Error {
  public readonly totalPaisa: bigint

  constructor(totalPaisa: bigint) {
    super(
      `STAGING_PAYMENT_BLOCK refuses priced orders; set STAGING_PAYMENT_BLOCK=0 to bypass (production cutover only). Order total: ${totalPaisa} paisa.`,
    )
    this.name = 'StagingPaymentBlockedError'
    this.totalPaisa = totalPaisa
  }
}

/**
 * Returns true iff STAGING_PAYMENT_BLOCK is in its "on" state. Helper
 * for callers that want to branch on the gate state without throwing
 * (e.g. an admin UI showing a banner).
 */
export function isStagingPaymentBlockEnabled(): boolean {
  return process.env['STAGING_PAYMENT_BLOCK'] === '1'
}

/**
 * Hard-refuses any priced EPS initialisation when the block is on. Free
 * orders (totalPaisa === 0n) pass through regardless — §13.5 keeps them
 * out of the EPS code path entirely, but defence in depth.
 *
 * @throws {StagingPaymentBlockedError} when block is on AND order is priced.
 */
export function assertEpsCallAllowed(totalPaisa: bigint): void {
  if (typeof totalPaisa !== 'bigint') {
    throw new TypeError(`totalPaisa must be a bigint; received ${typeof totalPaisa}`)
  }
  if (isStagingPaymentBlockEnabled() && totalPaisa > 0n) {
    throw new StagingPaymentBlockedError(totalPaisa)
  }
}

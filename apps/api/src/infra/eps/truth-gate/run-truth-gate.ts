/**
 * Decision N truth-gate — execution entrypoint.
 *
 * Run via:
 *
 *   pnpm --filter @eventpulse/api exec tsx \
 *     src/infra/eps/truth-gate/run-truth-gate.ts
 *
 * **PREREQUISITES (must all be true before execution)** — see also
 * `./harness.ts` header for the full rationale:
 *
 *   1. **EPS sandbox credentials confirmed.** Currently staging carries
 *      PRODUCTION credentials per `.claude/memory/decisions.md` "EPS
 *      production credentials intentionally used in staging" (2026-05-
 *      19); the STAGING_PAYMENT_BLOCK guard refuses priced calls
 *      against them. Either:
 *
 *        (a) EPS issues a separate sandbox credential set, populated
 *            at `eventpulse/staging/eps-sandbox` Secrets Manager
 *            entry; the gate runs against `EPS_MODE=sandbox` — SAFEST.
 *        (b) Moshiur explicitly authorises lifting
 *            STAGING_PAYMENT_BLOCK against production credentials
 *            for the 4 truth-gate transactions only (each charging
 *            ~BDT 1,000 to a real card) — fast but expensive +
 *            requires new `decisions.md` entry per §11.0 guardrail.
 *
 *   2. **§29 #9 tax-withholding opinion received.** The calculator
 *      currently ships PRE-withholding (per `fee-calculator.ts`
 *      header). The gate measures EPS mechanics in isolation, but
 *      interpreting organiser_net against the calculator requires
 *      knowing whether a withholding line should be deducted from
 *      the calculator's prediction before comparison. **Moshiur to
 *      confirm.**
 *
 *   3. **EPS wrapper Part 2 (Day 26-28) implementation, OR a
 *      manually-driven observation provider.** The wrapper's real
 *      InitializeEPS + Verify calls are the technical prerequisite
 *      for an automated observation provider. If running before
 *      Day 26-28, supply observations manually (a buyer click-
 *      through against the EPS gateway + manual fee capture into the
 *      `manualObservationsByModeId` map at the bottom of this file).
 *
 * **If executed without prerequisites met:** the noop observation
 * provider throws with a clear prerequisites-not-met error listing
 * the missing items. No EPS network call is made.
 *
 * **What Day 24 (this PR) ships in this file:** the entrypoint
 * structure + wiring + clearly-named extension points
 * (`liveObservationProvider`, `manualObservationProvider`) for
 * Day 24-25 execution time. The entrypoint refuses to run today
 * because the noop provider is the only one wired.
 *
 * **Day 24-25 execution checklist (when prerequisites met):**
 *
 *   - [ ] Verify EPS_MODE = 'sandbox' OR explicit production-with-
 *         block-lifted decision in `.claude/memory/decisions.md`
 *   - [ ] Tax-withholding opinion docs-linked or noted as "assume
 *         no withholding for the comparison"
 *   - [ ] Either Day-26-28 wrapper landed OR manual provider
 *         observations populated below
 *   - [ ] Run: `pnpm --filter @eventpulse/api exec tsx
 *         src/infra/eps/truth-gate/run-truth-gate.ts`
 *   - [ ] Append report to `.claude/memory/decisions.md` as a follow-
 *         up entry "Decision N truth-gate executed YYYY-MM-DD —
 *         result <ALL MATCH | N shifts>"
 *   - [ ] If shifts: amend `apps/api/src/domain/payments/fee-
 *         calculator.ts` + §14.2; re-run §24.4 fee-mode tests; re-
 *         run this gate; iterate until ALL MATCH.
 *   - [ ] If ALL MATCH: Day 26+ unblocked.
 */

import { formatReport, noopObservationProvider, runTruthGate } from './harness.js'
import { TRUTH_GATE_SCENARIOS } from './scenarios.js'

/**
 * Day 24-25 execution will replace `noopObservationProvider` here
 * with either:
 *
 *   - A `liveObservationProvider` that drives the Phase 3 wrapper to
 *     create + verify a real EPS sandbox transaction per scenario.
 *   - A `manualObservationProvider(observations)` that reads pre-
 *     captured paisa fees from a manually-populated map (useful when
 *     the wrapper Part 2 isn't yet wired and a human buyer ran the
 *     gateway click-through).
 *
 * Sketch (NOT WIRED at Day 24):
 *
 * ```ts
 * import { initialiseOrder, verifyOrder } from '../client.js'
 *
 * const liveObservationProvider: EpsObservationProvider = async (scenario) => {
 *   const merchantTransactionId = `TXN-TRUTH-${scenario.modeId}-${Date.now()}`
 *   await initialiseOrder({
 *     merchantTransactionId,
 *     totalPaisa: scenario.calculatorPrediction.buyerTotalPaisa,
 *     // ... full Order shape Day 26-28
 *   })
 *   // <buyer drives gateway click-through, or test card autopay>
 *   const result = await verifyOrder({ merchantTransactionId })
 *   // result.raw carries EPS's fee; extract per the V5 response shape
 *   return { observedEpsFeePaisa: extractEpsFee(result.raw), rawResponse: result.raw }
 * }
 *
 * const manualObservationProvider = (map: Record<ModeId, bigint>): EpsObservationProvider =>
 *   async (scenario) => ({ observedEpsFeePaisa: map[scenario.modeId], rawResponse: { manual: true } })
 * ```
 *
 * Until Day 24-25 execution, the noop provider keeps the entrypoint
 * safe — running this script today produces a clear prerequisites-
 * not-met error.
 */
async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Decision N truth-gate — Day 24 PREP-only entrypoint')
  // eslint-disable-next-line no-console
  console.log('See header for prerequisites + execution checklist.')

  const report = await runTruthGate(TRUTH_GATE_SCENARIOS, noopObservationProvider)
  // eslint-disable-next-line no-console
  console.log(formatReport(report))

  process.exit(report.allMatch ? 0 : 1)
}

// Only invoke main when run as a script (tsx entrypoint), not when
// imported by tests.
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(2)
  })
}

/**
 * Decision N truth-gate harness — the comparator that drives a real
 * EPS sandbox observation against the calculator's prediction for
 * each of the 4 §14.2 scenarios.
 *
 * The harness itself is pure: given (a) the 4 scenarios from
 * `./scenarios.ts` and (b) an `EpsObservationProvider` that knows how
 * to elicit a real EPS-charged fee for a given scenario, the harness
 * computes per-mode deltas and returns a structured report.
 *
 * Wiring the observation provider is the load-bearing step that
 * gates live truth-gate execution:
 *
 *   - At Day 24 (this PR) → only the noop provider exists; harness
 *     can be unit-tested against synthetic observations.
 *   - At Day 24-25 execution time → a `liveSandboxObservationProvider`
 *     wraps the Phase 3 wrapper (PR #150) to initialise a real EPS
 *     sandbox transaction in each mode, complete it through the
 *     gateway UI, capture EPS's actual fee from the Verify response,
 *     and feed that observation into the harness.
 *
 * The harness DOES NOT execute live transactions itself. Day 24-25
 * execution requires:
 *
 *   1. **EPS sandbox credentials confirmed.** Currently staging carries
 *      PRODUCTION credentials per Day 20 decision; the
 *      STAGING_PAYMENT_BLOCK guard refuses priced calls against them.
 *      To run the gate either (a) EPS issues a separate sandbox
 *      credential set, OR (b) Moshiur explicitly authorises lifting
 *      STAGING_PAYMENT_BLOCK against production credentials for the
 *      4 truth-gate transactions only (each charging ~BDT 1,000 to
 *      a real card). (a) is the safer path.
 *   2. **Tax-withholding opinion (§29 #9).** The calculator currently
 *      ships PRE-withholding (per `fee-calculator.ts` header). The
 *      gate measures EPS mechanics in isolation, but interpreting
 *      organiser_net against the calculator requires knowing whether
 *      a withholding line should be deducted from the calculator's
 *      prediction before comparison. Moshiur to confirm.
 *   3. **The EPS wrapper Part 2 (Day 26-28) implementation, OR a
 *      manually-driven version of the same.** The wrapper's real
 *      InitializeEPS + Verify calls are the technical prerequisite
 *      for the live observation provider. If the wrapper isn't yet
 *      wired but the gate is otherwise unblocked, a one-off scripted
 *      direct-fetch against the EPS sandbox + manual buyer click-
 *      through can substitute, with the observation entered manually
 *      into the harness.
 *
 * Output report shape: per-scenario verdict (`'match'` / `'shift'`)
 * plus the canonical Decision-N-rule restatement on shift: "the
 * calculator is the variable to change, NOT the sandbox observation."
 */

import type { TruthGateScenario } from './scenarios.js'

/**
 * Caller-supplied: given a scenario, return the EPS-charged fee in
 * paisa as observed from a real EPS sandbox/production transaction.
 *
 * Day 24-25 execution provider wraps the Phase 3 EPS wrapper. Unit
 * tests of the harness supply a synthetic provider for matrix
 * verification.
 */
export type EpsObservationProvider = (
  scenario: TruthGateScenario,
) => Promise<{ observedEpsFeePaisa: bigint; rawResponse: unknown }>

/**
 * Per-scenario truth-gate verdict.
 */
export interface TruthGateVerdict {
  modeId: TruthGateScenario['modeId']
  modeLabel: TruthGateScenario['modeLabel']
  /** What the calculator predicted (single source of money truth). */
  predictedEpsFeePaisa: bigint
  /** What EPS actually charged (the sandbox observation). */
  observedEpsFeePaisa: bigint
  /** observed - predicted; positive = calculator under-predicts. */
  deltaPaisa: bigint
  verdict: 'match' | 'shift'
}

/**
 * Top-level truth-gate report.
 */
export interface TruthGateReport {
  /** All 4 mode verdicts in scenario order (A → D). */
  verdicts: TruthGateVerdict[]
  /** True iff every verdict is `'match'`. */
  allMatch: boolean
  /** Filtered list of shifts for fast triage. */
  shifts: TruthGateVerdict[]
  /** The Decision N rule restated for any consumer reading the report. */
  ruleOnShift: string
}

const RULE_ON_SHIFT =
  'Decision N (2026-05-19): any delta is a CALCULATOR BUG. The calculator is the variable to change, NOT the sandbox observation. After amending calculator + §14.2, re-run the §24.4 fee-mode tests, then re-run this gate.'

/**
 * Run the truth gate against a given observation provider. Pure
 * orchestration; defers the load-bearing live-call work to the
 * provider.
 *
 * Throws nothing — the report's `allMatch` field is the success
 * signal. Throwing on shift would be inverted: shift is a bug-found
 * outcome, not an error.
 */
export async function runTruthGate(
  scenarios: ReadonlyArray<TruthGateScenario>,
  provider: EpsObservationProvider,
): Promise<TruthGateReport> {
  const verdicts: TruthGateVerdict[] = []
  for (const scenario of scenarios) {
    const { observedEpsFeePaisa } = await provider(scenario)
    const predictedEpsFeePaisa = scenario.calculatorPrediction.epsFeePaisa
    const deltaPaisa = observedEpsFeePaisa - predictedEpsFeePaisa
    verdicts.push({
      modeId: scenario.modeId,
      modeLabel: scenario.modeLabel,
      predictedEpsFeePaisa,
      observedEpsFeePaisa,
      deltaPaisa,
      verdict: deltaPaisa === 0n ? 'match' : 'shift',
    })
  }
  const shifts = verdicts.filter((v) => v.verdict === 'shift')
  return {
    verdicts,
    allMatch: shifts.length === 0,
    shifts,
    ruleOnShift: RULE_ON_SHIFT,
  }
}

/**
 * Provider stub for Day 24 work. Throws a clear "live execution not
 * authorised this session" error if invoked. Day 24-25 execution
 * replaces this at the script entrypoint with a real wrapper-driven
 * provider (or a manual-observation provider).
 */
export const noopObservationProvider: EpsObservationProvider = async () => {
  throw new Error(
    'noopObservationProvider: truth-gate execution requires (1) confirmed EPS sandbox creds OR explicit STAGING_PAYMENT_BLOCK lift; (2) §29 #9 tax-withholding opinion; (3) Day 26-28 wrapper Part 2 OR a manual-observation provider. See `run-truth-gate.ts` header for the unblocking sequence.',
  )
}

/**
 * Render a human-readable report. Used by the script entrypoint and
 * by anyone consuming the report from a CI summary.
 */
export function formatReport(report: TruthGateReport): string {
  const lines: string[] = []
  lines.push('Decision N truth-gate report')
  lines.push('=============================')
  lines.push('')
  for (const v of report.verdicts) {
    const sign = v.deltaPaisa > 0n ? '+' : ''
    lines.push(
      `Mode ${v.modeId} (${v.modeLabel}): predicted=${v.predictedEpsFeePaisa}p observed=${v.observedEpsFeePaisa}p delta=${sign}${v.deltaPaisa}p → ${v.verdict.toUpperCase()}`,
    )
  }
  lines.push('')
  if (report.allMatch) {
    lines.push('VERDICT: ALL MATCH — calculator is correct; Day 26+ unblocked.')
  } else {
    lines.push(`VERDICT: ${report.shifts.length} shift(s) detected.`)
    lines.push('')
    lines.push(report.ruleOnShift)
  }
  return lines.join('\n')
}

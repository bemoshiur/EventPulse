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
 * **What the sandbox-config PR ships in this file:** the live sandbox
 * observation provider is now WIRED — `main()` drives
 * `makeLiveSandboxObservationProvider`, which loads the sandbox config
 * (`../sandbox-config.ts`) and runs the REAL `initialiseOrderHttp` +
 * `verifyOrderHttp` against the sandbox host via an injected
 * `EpsCallDeps`. The noop→sandbox swap is therefore complete AND lives
 * ONLY here (no running service imports this file).
 *
 * It still cannot run a transaction: the provider's `SecretFetcher`
 * defaults to `unwiredSecretFetcher`, which throws — with the unblocking
 * sequence — BEFORE any network call. Phase-1 execution supplies a real
 * Secrets Manager fetcher (+ adds `@aws-sdk/client-secrets-manager` per
 * §1.4) and the `eventpulse/staging/eps-sandbox` secret, at which point
 * the same wiring reaches sandbox for real. Running this script today
 * prints the prereqs and exits via the unwired-fetcher throw — no EPS
 * call, no charge.
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

import {
  createSandboxEpsCallDeps,
  loadSandboxEpsConfig,
  unwiredSecretFetcher,
  type SecretFetcher,
} from '../sandbox-config.js'
import { initialiseOrderHttp } from '../initialise-order.js'
import { verifyOrderHttp } from '../verify-order.js'
import { formatReport, runTruthGate, type EpsObservationProvider } from './harness.js'
import { TRUTH_GATE_SCENARIOS } from './scenarios.js'

/**
 * Pull the EPS-charged fee (paisa) out of a Verify response.
 *
 * [truth-gate-verify] The exact field EPS uses for the gateway fee in the
 * CheckMerchantTransactionStatus response is NOT pinned by §11 — it will be
 * confirmed against the first live sandbox response at Phase-1 execution.
 * This reads the most likely candidates (top-level + nested `data.*`) and
 * throws a clear, actionable error when none is present, rather than
 * silently returning 0 (which would fake a "match" and defeat the gate).
 */
export function extractEpsFeePaisa(raw: unknown): bigint {
  const candidates = ['epsFee', 'EpsFee', 'EPSFee', 'gatewayFee', 'GatewayFee', 'fee', 'Fee']
  const roots: unknown[] = [raw]
  if (raw != null && typeof raw === 'object' && 'data' in raw) {
    roots.push((raw as Record<string, unknown>)['data'])
  }
  for (const root of roots) {
    if (root == null || typeof root !== 'object') continue
    const obj = root as Record<string, unknown>
    for (const key of candidates) {
      const v = obj[key]
      if (typeof v === 'bigint') return v
      if (typeof v === 'number' && Number.isInteger(v)) return BigInt(v)
      if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v)
    }
  }
  throw new Error(
    '[truth-gate-verify] extractEpsFeePaisa: no recognised EPS-fee field in Verify response. ' +
      'Pin the actual field name against the first live sandbox response, then extend `candidates`. ' +
      `Raw keys seen: ${raw && typeof raw === 'object' ? Object.keys(raw as object).join(',') : typeof raw}`,
  )
}

/**
 * The live sandbox observation provider — the noop→sandbox swap. Drives the
 * REAL wrapper (`initialiseOrderHttp` + `verifyOrderHttp`) against an
 * injected sandbox `EpsCallDeps` built from `sandbox-config.ts`. This is the
 * ONLY construct in the codebase that pairs the wrapper with sandbox deps,
 * and it lives only in this script entrypoint.
 *
 * Isolation: the deps' axios client is pinned to the sandbox host and the
 * config.mode is `'sandbox'` — this provider structurally cannot reach
 * production EPS. It never reads `process.env.EPS_*` and never touches the
 * `defaultTokenCache()` singleton.
 *
 * Safety: `fetchSecret` defaults to {@link unwiredSecretFetcher}, so calling
 * the returned provider throws (no network) until Phase-1 wires a real
 * fetcher. The sandbox deps are loaded lazily on first scenario + reused.
 *
 * NOTE (Phase-1, not now): on staging `STAGING_PAYMENT_BLOCK=1` is read from
 * env by `assertEpsCallAllowed`, which is mode-AGNOSTIC — it would refuse the
 * priced InitializeEPS here even in sandbox mode. Resolving that interaction
 * (sandbox-mode priced calls vs. the env block) is a Phase-1 execution
 * decision; this PREP wiring deliberately does not touch the block.
 */
export function makeLiveSandboxObservationProvider(
  fetchSecret: SecretFetcher = unwiredSecretFetcher,
): EpsObservationProvider {
  let depsPromise: ReturnType<typeof buildSandboxDeps> | null = null
  const buildSandboxDeps = async () => {
    const setup = await loadSandboxEpsConfig(fetchSecret)
    return createSandboxEpsCallDeps(setup)
  }
  return async (scenario) => {
    depsPromise ??= buildSandboxDeps()
    const deps = await depsPromise
    const merchantTransactionId = `TXN-TRUTH-${scenario.modeId}-${Date.now()}`
    // Init the order in sandbox (returns a RedirectURL). At execution time a
    // sandbox test-card autopay / buyer click-through completes payment
    // between init and verify; the gate is never run unattended.
    await initialiseOrderHttp(
      {
        merchantTransactionId,
        totalPaisa: scenario.calculatorPrediction.buyerTotalPaisa,
      },
      deps,
    )
    const result = await verifyOrderHttp({ merchantTransactionId }, deps)
    return { observedEpsFeePaisa: extractEpsFeePaisa(result.raw), rawResponse: result.raw }
  }
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Decision N truth-gate — entrypoint (live sandbox provider wired)')
  // eslint-disable-next-line no-console
  console.log('See header for prerequisites + execution checklist.')

  // The swap is done: main() uses the live sandbox provider. With the
  // default unwired fetcher this throws before any network — Phase-1
  // passes a real SecretFetcher here.
  const provider = makeLiveSandboxObservationProvider()
  const report = await runTruthGate(TRUTH_GATE_SCENARIOS, provider)
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

/**
 * Decision N truth-gate — execution entrypoint.
 *
 * Three modes (argv[2]):
 *
 *   - `init`   → Phase 1.4 option-A. GetToken + InitializeEPS for the 4 §14.2
 *                scenarios against EPS SANDBOX; prints `TG_INIT` lines with each
 *                merchantTransactionId + RedirectURL, then exits. The operator
 *                pays each RedirectURL with the EPS sandbox test card.
 *   - `verify` → takes `MODE:MTID` args; CheckMerchantTransactionStatus for
 *                each, prints the full raw response + observed-vs-predicted EPS
 *                fee + the §14.10 Invariant-1 check.
 *   - (none)   → full automated run (init+verify back-to-back); only usable
 *                with a sandbox test-card autopay.
 *
 * Run on the staging box via SSM with the block explicitly on, e.g.:
 *
 *   STAGING_PAYMENT_BLOCK=1 pnpm --filter @eventpulse/api exec tsx \
 *     src/infra/eps/truth-gate/run-truth-gate.ts init
 *
 * The priced InitializeEPS succeeds ONLY because the sandbox deps carry the
 * SandboxPricedCallToken (Phase 1.2). Every other path with the block on is
 * still refused. The harness reaches SANDBOX only (mode hard-coded 'sandbox',
 * base URL sandboxpgapi.eps.com.bd); it never touches production.
 *
 * Prerequisites for a live run: the `eventpulse/staging/eps-sandbox` secret
 * populated (Phase-1.0 confirmed) + the real Secrets Manager fetcher (Phase
 * 1.1) + the block bypass (Phase 1.2) — all in place. The fee comparison
 * assumes no withholding line (calculator ships pre-withholding per
 * `fee-calculator.ts`); the gate measures EPS mechanics in isolation.
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

import { parseBdtDecimalToPaisa } from '../bdt-decimal.js'
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

const AWS_REGION = 'ap-southeast-1'

/**
 * Minimal shape of the Secrets Manager client this module needs — just
 * `send(GetSecretValueCommand)`. Declared so `makeSecretsManagerFetcher` can
 * accept a stub client in tests without mocking the AWS SDK module.
 */
export interface SecretsManagerLike {
  send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>
}

/**
 * The REAL Secrets Manager-backed {@link SecretFetcher} (Phase 1.1). Reads
 * the raw `SecretString` for a given secret id. Credentials come from the
 * EC2 instance role (the harness runs on the staging box via SSM); region is
 * pinned to the platform region.
 *
 * This lives in the harness entrypoint (the ONLY file allowed to import
 * `sandbox-config`) so no running-service path can obtain it. It is wired
 * into the live provider ONLY inside {@link main} — never as a default.
 *
 * The client is injectable purely so tests can pass a stub `send`; production
 * uses the default `SecretsManagerClient`.
 */
export function makeSecretsManagerFetcher(
  client: SecretsManagerLike = new SecretsManagerClient({ region: AWS_REGION }),
): SecretFetcher {
  return async (secretId: string) => {
    const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
    if (!out.SecretString) {
      throw new Error(`secretsManagerFetcher: secret '${secretId}' has no SecretString`)
    }
    return out.SecretString
  }
}

/**
 * Derive the pure EPS-fee observation in paisa from a V4
 * CheckMerchantTransactionStatus response.
 *
 * **Derivation rule (mode-agnostic):**
 *
 *     eps_fee_paisa = parseBdtDecimalToPaisa(TotalAmount)
 *                   − parseBdtDecimalToPaisa(StoreAmount)
 *
 * Where `TotalAmount` is what EPS captured from the buyer and `StoreAmount`
 * is what EPS will settle to the merchant after deducting its gateway fee.
 * Their difference is the pure EPS fee, independent of how Event Pulse's
 * platform fee was composed (absorb vs pass-through), independent of the
 * §14.2 mode.
 *
 * **No per-mode blind spot.** The earlier `(TotalAmount − subtotal)` rule
 * conflated platform_fee + eps_fee in Mode A and was empirically invisible
 * in Modes B/D. `(TotalAmount − StoreAmount)` resolves that: every mode
 * yields the same authoritative split EPS itself publishes.
 *
 * **Empirically: EPS charges payment-method-dependent rates.** Mode A
 * sandbox (bKash) returned TotalAmount=1027.56, StoreAmount=1010.09 →
 * eps_fee = 17.47 BDT = 1.747% on face value (MFS rate), not the
 * card-rate 2.5% the calculator currently models. The structural
 * decision (per-method rates / single-rate with absorbed variance /
 * restrict-to-one-method) is captured in decisions.md and pending — this
 * function only reports the empirical truth.
 *
 * Throws if `raw` is not an object, if `TotalAmount` is missing/not-string,
 * or if `StoreAmount` is missing/not-string. Never returns 0n silently.
 */
export function extractEpsFeePaisa(raw: unknown): bigint {
  if (raw == null || typeof raw !== 'object') {
    throw new Error(
      `[truth-gate-verify] extractEpsFeePaisa: Verify raw is not an object (typeof=${typeof raw}); cannot read TotalAmount/StoreAmount.`,
    )
  }
  const obj = raw as Record<string, unknown>
  const totalAmountBdt = obj['TotalAmount']
  if (typeof totalAmountBdt !== 'string') {
    throw new Error(
      `[truth-gate-verify] extractEpsFeePaisa: V4 Verify response missing string TotalAmount field. Got: ${JSON.stringify(totalAmountBdt)}. Keys seen: ${Object.keys(obj).join(',')}`,
    )
  }
  const storeAmountBdt = obj['StoreAmount']
  if (typeof storeAmountBdt !== 'string') {
    throw new Error(
      `[truth-gate-verify] extractEpsFeePaisa: V4 Verify response missing string StoreAmount field. Got: ${JSON.stringify(storeAmountBdt)}. Keys seen: ${Object.keys(obj).join(',')}`,
    )
  }
  return parseBdtDecimalToPaisa(totalAmountBdt) - parseBdtDecimalToPaisa(storeAmountBdt)
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
  opts: { allowPricedCalls?: boolean } = {},
): EpsObservationProvider {
  let depsPromise: ReturnType<typeof buildSandboxDeps> | null = null
  const buildSandboxDeps = async () => {
    const setup = await loadSandboxEpsConfig(fetchSecret)
    // Priced sandbox InitializeEPS needs the block bypass. createSandboxEpsCallDeps
    // mints the sandbox-scoped capability token only when allowPricedCalls is set.
    return createSandboxEpsCallDeps(setup, { allowPricedCalls: opts.allowPricedCalls ?? false })
  }
  return async (scenario) => {
    depsPromise ??= buildSandboxDeps()
    const deps = await depsPromise
    const merchantTransactionId = `TXN-TRUTH-${scenario.modeId}-${Date.now()}`
    // V4 sandbox requires a SEPARATE merchant-side order reference per the
    // V4 guide. We derive one from the mtid to keep them deterministically
    // related but distinct (mtid stays the EPS-side reference).
    const customerOrderId = `ORDER-${merchantTransactionId}`
    // Init the order in sandbox (returns a RedirectURL). At execution time a
    // sandbox test-card autopay / buyer click-through completes payment
    // between init and verify; the gate is never run unattended.
    await initialiseOrderHttp(
      {
        merchantTransactionId,
        customerOrderId,
        totalPaisa: scenario.calculatorPrediction.buyerTotalPaisa,
      },
      deps,
    )
    const result = await verifyOrderHttp({ merchantTransactionId }, deps)
    return {
      observedEpsFeePaisa: extractEpsFeePaisa(result.raw),
      rawResponse: result.raw,
    }
  }
}

/**
 * Build the sandbox call-deps for an interactive run: real Secrets Manager
 * fetcher + the priced-call bypass token. Shared by the init + verify phases.
 */
async function buildInteractiveSandboxDeps(fetchSecret: SecretFetcher) {
  const setup = await loadSandboxEpsConfig(fetchSecret)
  return createSandboxEpsCallDeps(setup, { allowPricedCalls: true })
}

/* eslint-disable no-console */

/**
 * Phase 1.4 option-A INIT phase. For each of the 4 §14.2 scenarios:
 * GetToken + InitializeEPS against sandbox, then print the merchantTransactionId
 * + RedirectURL. The operator opens each URL, pays the EPS sandbox test card,
 * then runs the `verify` phase with the printed mtids. Prints machine-parseable
 * `TG_INIT` lines.
 */
async function runInitPhase(fetchSecret: SecretFetcher): Promise<void> {
  const deps = await buildInteractiveSandboxDeps(fetchSecret)
  console.log('Decision N truth-gate — INIT phase (sandbox; block bypassed via token)')
  for (const s of TRUTH_GATE_SCENARIOS) {
    const mtid = `TXN-TG-${s.modeId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    // V4 sandbox requires a distinct merchant-side CustomerOrderId per the
    // V4 guide. We derive deterministically from mtid.
    const customerOrderId = `ORDER-${mtid}`
    const totalPaisa = s.calculatorPrediction.buyerTotalPaisa
    const { redirectUrl } = await initialiseOrderHttp(
      { merchantTransactionId: mtid, customerOrderId, totalPaisa },
      deps,
    )
    console.log(
      `TG_INIT mode=${s.modeId} label=${s.modeLabel} buyerTotalPaisa=${totalPaisa.toString()} mtid=${mtid} customerOrderId=${customerOrderId} url=${redirectUrl}`,
    )
  }
  console.log('TG_INIT_DONE — pay each url, then run: verify mode:mtid mode:mtid ...')
}

/**
 * Phase 1.4 option-A VERIFY phase. Args are `MODE:MTID` pairs (e.g. `A:TXN-...`).
 * For each, CheckMerchantTransactionStatus against sandbox, print the FULL raw
 * response (so the actual fee field can be pinned — [truth-gate-verify]),
 * attempt to extract the observed EPS fee, and emit the predicted-vs-observed
 * delta + the §14.10 Invariant-1 check on the calculator's decomposition.
 */
async function runVerifyPhase(fetchSecret: SecretFetcher, pairs: string[]): Promise<void> {
  const deps = await buildInteractiveSandboxDeps(fetchSecret)
  const byMode = new Map<string, string>()
  for (const pair of pairs) {
    const idx = pair.indexOf(':')
    if (idx > 0) byMode.set(pair.slice(0, idx), pair.slice(idx + 1))
  }
  console.log('Decision N truth-gate — VERIFY phase')
  for (const s of TRUTH_GATE_SCENARIOS) {
    const mtid = byMode.get(s.modeId)
    if (!mtid) {
      console.log(`TG_VERIFY mode=${s.modeId} SKIPPED (no mtid supplied)`)
      continue
    }
    const result = await verifyOrderHttp({ merchantTransactionId: mtid }, deps)
    const p = s.calculatorPrediction
    // §14.10 Invariant 1 on the calculator's decomposition (withholding = 0):
    const inv =
      p.subtotalPaisa +
        (s.platformFeeHandling === 'pass_through' ? p.platformFeePaisa : 0n) +
        (s.epsFeeHandling === 'pass_through' ? p.epsFeePaisa : 0n) ===
      p.buyerTotalPaisa
    // Parse observed buyer total + store amount + financial entity directly
    // from the V4 Verify envelope. Derivation is now mode-agnostic:
    //   eps_fee = TotalAmount − StoreAmount (per extractEpsFeePaisa docstring).
    let observedBuyerTotalPaisa: bigint | null = null
    let observedStoreAmountPaisa: bigint | null = null
    let financialEntity: string | null = null
    let derived: string
    try {
      const rawObj = result.raw as Record<string, unknown> | null
      const totalAmountBdt = rawObj?.['TotalAmount']
      const storeAmountBdt = rawObj?.['StoreAmount']
      const fe = rawObj?.['FinancialEntity']
      if (typeof totalAmountBdt === 'string') {
        observedBuyerTotalPaisa = parseBdtDecimalToPaisa(totalAmountBdt)
      }
      if (typeof storeAmountBdt === 'string') {
        observedStoreAmountPaisa = parseBdtDecimalToPaisa(storeAmountBdt)
      }
      if (typeof fe === 'string') {
        financialEntity = fe
      }
      derived = extractEpsFeePaisa(result.raw).toString()
    } catch (err) {
      derived = `UNEXTRACTED (${err instanceof Error ? err.message : String(err)})`
    }
    console.log(`TG_VERIFY mode=${s.modeId} status=${result.status} mtid=${mtid}`)
    console.log(`  financialEntity=${financialEntity ?? '(missing)'}`)
    console.log(
      `  predictedBuyerTotalPaisa=${p.buyerTotalPaisa.toString()} observedBuyerTotalPaisa=${
        observedBuyerTotalPaisa?.toString() ?? '(unparseable)'
      }`,
    )
    console.log(
      `  observedStoreAmountPaisa=${observedStoreAmountPaisa?.toString() ?? '(unparseable)'}`,
    )
    console.log(
      `  predictedEpsPaisa=${p.epsFeePaisa.toString()} observedEpsPaisa=${derived}  (= TotalAmount − StoreAmount, mode-agnostic)`,
    )
    console.log(
      `  §14.10_invariant1=${inv ? 'PASS' : 'FAIL'} (subtotal + pass-through fees == buyerTotal)`,
    )
    console.log(`  RAW=${JSON.stringify(result.raw)}`)
  }
  console.log('TG_VERIFY_DONE')
}

async function main(): Promise<void> {
  // Phase 1.1: REAL Secrets Manager fetcher supplied at invocation only.
  // Phase 1.2: priced-sandbox block bypass opted into here, and ONLY here.
  const fetchSecret = makeSecretsManagerFetcher()
  const sub = process.argv[2]

  if (sub === 'init') {
    await runInitPhase(fetchSecret)
    return
  }
  if (sub === 'verify') {
    await runVerifyPhase(fetchSecret, process.argv.slice(3))
    return
  }

  // Default: full automated run (init+verify back-to-back per scenario). Only
  // usable with a sandbox test-card autopay; the interactive option-A flow uses
  // the `init` / `verify` subcommands above instead.
  console.log('Decision N truth-gate — full automated run (use `init` / `verify` for option A)')
  const provider = makeLiveSandboxObservationProvider(fetchSecret, { allowPricedCalls: true })
  const report = await runTruthGate(TRUTH_GATE_SCENARIOS, provider)
  console.log(formatReport(report))
  process.exit(report.allMatch ? 0 : 1)
}

/* eslint-enable no-console */

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

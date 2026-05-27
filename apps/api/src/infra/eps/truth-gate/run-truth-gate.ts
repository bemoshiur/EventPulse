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
    const totalPaisa = s.calculatorPrediction.buyerTotalPaisa
    const { redirectUrl } = await initialiseOrderHttp(
      { merchantTransactionId: mtid, totalPaisa },
      deps,
    )
    console.log(
      `TG_INIT mode=${s.modeId} label=${s.modeLabel} buyerTotalPaisa=${totalPaisa.toString()} mtid=${mtid} url=${redirectUrl}`,
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
    let observed: string
    try {
      observed = extractEpsFeePaisa(result.raw).toString()
    } catch (err) {
      observed = `UNEXTRACTED (${err instanceof Error ? err.message : String(err)})`
    }
    console.log(`TG_VERIFY mode=${s.modeId} status=${result.status} mtid=${mtid}`)
    console.log(`  predictedEpsPaisa=${p.epsFeePaisa.toString()} observedEpsFee=${observed}`)
    console.log(
      `  buyerTotalPaisa=${p.buyerTotalPaisa.toString()} §14.10_invariant1=${inv ? 'PASS' : 'FAIL'}`,
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

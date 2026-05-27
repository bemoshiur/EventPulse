/**
 * EPS SANDBOX config path — the isolated channel the Decision-N truth-gate
 * harness uses to reach the EPS sandbox WITHOUT touching the running
 * production-mode env or the STAGING_PAYMENT_BLOCK guard.
 *
 * ─── Why this module exists (bidirectional isolation) ───────────────────
 *
 * Staging runs the api/worker processes with `EPS_MODE=production` against
 * PRODUCTION credentials (per `.claude/memory/decisions.md` "EPS production
 * credentials intentionally used in staging" 2026-05-19); the
 * STAGING_PAYMENT_BLOCK=1 guard refuses any priced InitializeEPS call so a
 * test can never charge a real card. The truth gate, by contrast, needs to
 * drive REAL sandbox transactions to observe EPS's actual per-mode fee.
 *
 * Those two needs must never bleed into each other. This module is the
 * structural wall:
 *
 *   (a) HARNESS → SANDBOX ONLY. {@link loadSandboxEpsConfig} hard-codes
 *       `mode: 'sandbox'` (never read from env or even from the secret) and
 *       {@link createSandboxEpsCallDeps} builds a dedicated axios client
 *       whose `baseURL` is `BASE_URLS.sandbox` (`sandboxpgapi.eps.com.bd`).
 *       There is no code path here that can produce a production base URL.
 *
 *   (b) SERVICE → PRODUCTION ONLY. Nothing in this module reads
 *       `process.env.EPS_*`, and nothing in the running services imports
 *       this module. Services call the public surface
 *       (`initialiseOrder`/`verifyOrder`) with no deps → the wrapper
 *       resolves `defaultEpsCallDeps()` → env → production. A service can't
 *       accidentally become "sandbox" because the only producer of a
 *       `mode: 'sandbox'` config is this file, which services never touch.
 *
 *   (c) NO SHARED MUTABLE STATE. The sandbox deps carry their OWN axios
 *       client + their OWN ephemeral in-memory token cache (a fresh
 *       instance per `createSandboxEpsCallDeps` call, never the
 *       `defaultTokenCache()` singleton). A sandbox JWT can never land in
 *       the running process's cache, nor vice versa. The config object is
 *       frozen.
 *
 * ─── Secrets, not env ───────────────────────────────────────────────────
 *
 * The sandbox credentials live in a SEPARATE Secrets Manager entry
 * ({@link SANDBOX_EPS_SECRET_ID}) from the production `eventpulse/staging/eps`
 * entry that boots into `.env.staging`. They are loaded at harness-invocation
 * time via an injected {@link SecretFetcher}, never materialised into any
 * process env file.
 *
 * **The concrete AWS Secrets Manager fetcher is intentionally NOT wired in
 * this PREP PR**, for two reasons, mirroring how `harness.ts` ships
 * `noopObservationProvider` now and the live provider later:
 *
 *   1. The `eventpulse/staging/eps-sandbox` secret DOES NOT EXIST yet — EPS
 *      has not issued a sandbox credential set (prerequisite #1 in
 *      `harness.ts`). A real fetch would 404 today regardless.
 *   2. A real fetcher needs `@aws-sdk/client-secrets-manager`, a dependency
 *      not yet in `apps/api` — adding it is gated by CLAUDE.md §1.4 ("ask
 *      before introducing a new third-party dependency").
 *
 * So this module ships the PURE loader + the injection seam, fully unit-
 * tested with a stub fetcher. Phase-1 execution supplies the real fetcher
 * (one small function — see {@link SecretFetcher} docs) alongside the dep
 * add + the actual secret. {@link unwiredSecretFetcher} is the safe default:
 * calling the loader without a fetcher throws a clear, actionable error and
 * makes ZERO network calls — exactly like `noopObservationProvider`.
 */

import axios, { type AxiosInstance } from 'axios'
import { z } from 'zod'

import { BASE_URLS, type EpsCallDeps, type EpsConfig } from './core.js'
import { inMemoryTokenCache } from './token-cache.js'

/**
 * Secrets Manager entry holding the EPS *sandbox* credential set. Distinct
 * from the production `eventpulse/staging/eps` entry. Does not exist until
 * EPS issues sandbox credentials (harness prerequisite #1).
 */
export const SANDBOX_EPS_SECRET_ID = 'eventpulse/staging/eps-sandbox'

/**
 * Abstract secret loader: given a Secrets Manager secret id, return its raw
 * string value (the JSON blob). Injected so the loader is pure + testable
 * and so this module carries no AWS SDK dependency.
 *
 * Phase-1 execution wires the concrete implementation, e.g.:
 *
 * ```ts
 * import { SecretsManagerClient, GetSecretValueCommand }
 *   from '@aws-sdk/client-secrets-manager'  // dep add gated by §1.4
 *
 * const secretsManagerFetcher: SecretFetcher = async (secretId) => {
 *   const client = new SecretsManagerClient({}) // region from instance role
 *   const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
 *   if (!out.SecretString) throw new Error(`secret ${secretId} has no SecretString`)
 *   return out.SecretString
 * }
 * ```
 */
export type SecretFetcher = (secretId: string) => Promise<string>

/**
 * Default fetcher: refuses, loudly, with the unblocking sequence. Mirrors
 * `noopObservationProvider`. Guarantees that any attempt to use the sandbox
 * path without explicitly wiring a real fetcher makes NO network call and
 * fails with a clear message rather than silently doing nothing.
 */
export const unwiredSecretFetcher: SecretFetcher = async (secretId: string) => {
  throw new Error(
    `unwiredSecretFetcher: refusing to load '${secretId}'. The EPS sandbox secret ` +
      `fetcher is not wired in this PREP build. Phase-1 execution must (1) confirm EPS ` +
      `issued sandbox credentials populated at '${SANDBOX_EPS_SECRET_ID}', (2) add ` +
      `@aws-sdk/client-secrets-manager (CLAUDE.md §1.4), and (3) pass a real SecretFetcher ` +
      `to loadSandboxEpsConfig(). No network call was made.`,
  )
}

/**
 * Shape of the sandbox secret's JSON. The buyer-return URLs are carried IN
 * the secret so the sandbox path reads zero env. snake_case keys match the
 * production `eventpulse/staging/eps` secret convention (§11.3) plus the
 * three return URLs.
 */
const SandboxSecretSchema = z.object({
  merchant_id: z.string().min(1),
  store_id: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  hash_key: z.string().min(1),
  // mode is INTENTIONALLY NOT read from the secret — we hard-code 'sandbox'
  // below so no secret-content typo can ever route the harness at production.
  success_url: z.string().url(),
  fail_url: z.string().url(),
  cancel_url: z.string().url(),
})

/**
 * A fully-resolved sandbox setup: the immutable config + the buyer-return
 * URLs, both sourced from the secret. Frozen.
 */
export interface SandboxEpsSetup {
  readonly config: EpsConfig
  readonly redirectUrls: { successUrl: string; failUrl: string; cancelUrl: string }
}

/**
 * Load + validate the sandbox secret and construct the sandbox setup,
 * INDEPENDENTLY of `process.env`. The returned config's `mode` is always
 * `'sandbox'` regardless of secret contents.
 *
 * @throws if the fetcher rejects, the body isn't valid JSON, or the JSON
 *         fails {@link SandboxSecretSchema}.
 */
export async function loadSandboxEpsConfig(
  fetchSecret: SecretFetcher = unwiredSecretFetcher,
): Promise<SandboxEpsSetup> {
  const raw = await fetchSecret(SANDBOX_EPS_SECRET_ID)

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`loadSandboxEpsConfig: secret '${SANDBOX_EPS_SECRET_ID}' is not valid JSON`)
  }

  const result = SandboxSecretSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `loadSandboxEpsConfig: secret '${SANDBOX_EPS_SECRET_ID}' failed schema validation: ${result.error.message}`,
    )
  }
  const s = result.data

  const config: EpsConfig = Object.freeze({
    merchantId: s.merchant_id,
    storeId: s.store_id,
    username: s.username,
    password: s.password,
    hashKey: s.hash_key,
    // Hard-coded — the single structural guarantee that this path is sandbox.
    mode: 'sandbox',
  })

  return Object.freeze({
    config,
    redirectUrls: Object.freeze({
      successUrl: s.success_url,
      failUrl: s.fail_url,
      cancelUrl: s.cancel_url,
    }),
  })
}

/**
 * Build the {@link EpsCallDeps} bundle the truth-gate harness injects into
 * `initialiseOrderHttp` / `verifyOrderHttp`. Constructs:
 *
 *   - a DEDICATED axios instance pinned to the sandbox base URL (never the
 *     shared `http()` factory, which reads env mode);
 *   - a FRESH ephemeral in-memory token cache (never the
 *     `defaultTokenCache()` singleton) so sandbox JWTs are quarantined from
 *     the running process.
 *
 * Pure given the setup; constructs no env reads. `setup.config.mode` is
 * asserted `'sandbox'` defensively — a belt-and-braces guard so this
 * function can never be tricked into building a production-pointed client.
 */
export function createSandboxEpsCallDeps(setup: SandboxEpsSetup): EpsCallDeps {
  if (setup.config.mode !== 'sandbox') {
    // Unreachable via loadSandboxEpsConfig (which hard-codes sandbox); guards
    // against a hand-constructed setup being routed at production.
    throw new Error(
      `createSandboxEpsCallDeps: refusing non-sandbox config (mode='${setup.config.mode}'). This builder only ever serves the sandbox truth-gate path.`,
    )
  }
  const client: AxiosInstance = axios.create({
    baseURL: BASE_URLS.sandbox,
    timeout: 15_000,
    headers: { 'content-type': 'application/json' },
  })
  return {
    config: setup.config,
    client,
    cache: inMemoryTokenCache(),
    redirectUrls: setup.redirectUrls,
  }
}

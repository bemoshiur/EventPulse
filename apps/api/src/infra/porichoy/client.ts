/**
 * Porichoy NID verification adapter — scaffold only (Sprint 2 Day 20).
 *
 * Per `.claude/memory/decisions.md`:
 *   - "Porichoy deferred — manual NID review for MVP" (2026-05-17, superseded)
 *   - "Platform-wide policy — manual verification only for MVP
 *     (consolidates prior per-item deferrals)" (2026-05-19)
 *
 * This file ships the interface + env wiring + a stub that explicitly
 * refuses to run. It's the canonical pattern for all future automation
 * integrations (CLAUDE.md §13.0 v2.3 block "scaffold-only shape is the
 * canonical pattern"):
 *
 *   interface + env vars + Secrets Manager entry + TODO stub
 *
 * Live wiring lands in a focused PR alongside the operational decision
 * to flip from manual-only verification to manual-plus-flag, AFTER the
 * Phase 2 trigger fires (50 verified submissions/week sustained on a
 * 4-week trailing average — reviewer-capacity criterion). See §13.0
 * "Phase 2 trigger" for the full enabling conditions.
 *
 * **The stub is load-bearing.** Calling `nidVerify()` MUST throw a
 * loud, greppable error so any future code path that mistakenly wires
 * Porichoy in before the live integration is intentionally enabled
 * fails fast in tests + at runtime — never silently returns a "pass"
 * shape that the reviewer queue might trust.
 */

/**
 * The shape Porichoy returns per the public docs at
 * https://api.porichoy.gov.bd (subject to change once we get
 * credentials and can verify against live responses).
 *
 * Fields modelled defensively:
 *   - `verified` — boolean from the API; the only field the reviewer
 *     queue would consume.
 *   - `verificationId` — Porichoy's transaction id, persisted on the
 *     `kyc_submissions.porichoy_verification_id` column per migration
 *     0004 + CLAUDE.md §9.2.
 *   - `details` — passthrough; reviewer UI may surface raw fields
 *     (DOB-match, name-match, father-name-match) for context, but
 *     never as authoritative judgement signals — the §13.0 policy
 *     keeps reviewer judgement load-bearing even after automation
 *     lands.
 */
export interface PorichoyVerificationResult {
  verified: boolean
  verificationId: string
  details: Record<string, unknown>
}

/**
 * Interface every Porichoy client implementation conforms to.
 *
 * `nidVerify` is the only method scoped for MVP automation; future
 * methods (e.g. `addressVerify`, `signatureVerify`) lift the same
 * scaffold-then-real pattern.
 */
export interface PorichoyClient {
  /**
   * Verify a Bangladesh NID + name + DOB combination against the
   * Porichoy `gov.bd` registry.
   *
   * @param nid — 10-digit (legacy) or 17-digit (current) NID. Format
   *   validation happens upstream in the KYC schema; this method
   *   trusts its caller.
   * @param name — Full name as printed on the NID (Bengali OR English;
   *   Porichoy supports both).
   * @param dob — Date of birth in `YYYY-MM-DD` ISO format.
   *
   * @throws when credentials aren't configured (the scaffold-stub
   *   behaviour today); future implementations throw on transport
   *   failure + Porichoy-side rejection per their error envelope.
   */
  nidVerify(nid: string, name: string, dob: string): Promise<PorichoyVerificationResult>
}

/**
 * Error thrown by the scaffold stub when called before live wiring
 * lands. Greppable name, explicit decisions.md cross-reference in the
 * message — anyone hitting this in a stack trace finds the policy
 * immediately.
 */
export class PorichoyNotImplementedError extends Error {
  constructor() {
    super(
      'Porichoy integration not configured for MVP. Live NID verification is ' +
        'deferred per `.claude/memory/decisions.md` "Platform-wide policy — manual ' +
        'verification only for MVP (consolidates prior per-item deferrals)" ' +
        '(2026-05-19). Reviewer queue performs manual NID review. Re-enable by ' +
        'replacing this scaffold with a live implementation after the §13.0 Phase 2 ' +
        'trigger fires (50 verified submissions/week sustained, 4-week trailing ' +
        'average).',
    )
    this.name = 'PorichoyNotImplementedError'
  }
}

/**
 * Read Porichoy credentials from env. Used by future live
 * implementation; returned `null` shape lets the stub factory below
 * decide whether to log the missing-credentials INFO or whether
 * Phase 2 wiring has reached a state where credentials exist.
 */
export function readPorichoyConfig(): { apiKey: string; baseUrl: string } | null {
  const apiKey = process.env['POROCHOY_API_KEY']
  const baseUrl = process.env['POROCHOY_BASE_URL']
  // Note: env var names preserve the playbook spelling (POROCHOY_*) per
  // CLAUDE.md §13.2 + §13.0 v2.3 block. The domain itself is
  // `porichoy.gov.bd`; only the env var spelling carries the typo. Do
  // not rename without a v2.X playbook bump.
  if (!apiKey || !baseUrl) return null
  return { apiKey, baseUrl }
}

/**
 * Scaffold stub — refuses to run; throws PorichoyNotImplementedError.
 *
 * Future Phase 2 wiring replaces this with a live implementation
 * that:
 *   1. Constructs an axios client targeting `readPorichoyConfig().baseUrl`
 *   2. Calls the relevant Porichoy endpoint with HMAC-signed payload
 *   3. Maps the response to `PorichoyVerificationResult`
 *   4. Persists `verificationId` to `kyc_submissions.porichoy_verification_id`
 *   5. Surfaces the `verified` boolean as a non-blocking advisory flag
 *      in the reviewer queue (NEVER auto-rejects per §13.0 Phase 3 plan)
 *
 * The interface signature MUST remain stable as the Phase 2 wiring
 * lands — `nidVerify(nid, name, dob): Promise<PorichoyVerificationResult>`.
 * Any reviewer queue code consuming the result reads against this shape
 * starting today (scaffold) and continuing through live wiring (Phase 2+).
 */
export class PorichoyScaffoldStub implements PorichoyClient {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async nidVerify(_nid: string, _name: string, _dob: string): Promise<PorichoyVerificationResult> {
    throw new PorichoyNotImplementedError()
  }
}

/**
 * Factory — returns the current Porichoy client. Today: always the
 * scaffold stub. Phase 2 wiring extends this to return the live
 * implementation when `readPorichoyConfig()` returns non-null.
 *
 * Memoised so consumers can call this on hot paths without paying for
 * the construction cost repeatedly.
 */
let _client: PorichoyClient | undefined
export function porichoyClient(): PorichoyClient {
  if (_client) return _client
  _client = new PorichoyScaffoldStub()
  return _client
}

/** For tests: reset the memoised client. */
export function _resetPorichoyClient(): void {
  _client = undefined
}

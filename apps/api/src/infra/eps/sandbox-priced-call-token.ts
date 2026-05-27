/**
 * SandboxPricedCallToken — a branded, in-process capability that authorises a
 * SINGLE priced EPS call to bypass the STAGING_PAYMENT_BLOCK guard, and ONLY
 * for the Decision-N truth-gate harness running against the EPS SANDBOX.
 *
 * ─── Why a leaf module ──────────────────────────────────────────────────
 *
 * The bypass decision lives at one call site in `initialise-order.ts` (a
 * file the running services transitively import via `client.ts`). That file
 * therefore needs the token *type* + the `isSandboxPricedCallToken` typeguard
 * — both of which are safe to expose (a typeguard grants no capability).
 *
 * The *minting* capability (`SandboxPricedCallToken.mint`) requires a
 * `{ mode: 'sandbox' }` proof, and is invoked only by
 * `createSandboxEpsCallDeps` (in `sandbox-config.ts`, which the architectural
 * guard forbids any production file from importing) when the harness
 * explicitly opts in. So the sanctioned path to a token is: harness →
 * sandbox-config → mint. No running-service code imports sandbox-config or
 * the harness, so no service path obtains a token.
 *
 * The three independent locks at the call site (token present + injected-deps
 * `mode === 'sandbox'` + branded `instanceof`) mean a production-mode call
 * can never bypass even if somehow handed a token, and a shape-only fake
 * `{}` is rejected by the `instanceof` check.
 *
 * Threat model: this defeats *accidental* leakage and any *normal* service
 * path. It does not claim to stop a malicious rewrite that hand-builds
 * sandbox deps + mints a token inline — that is out of scope and is what the
 * architectural-guard tests + code review catch.
 */

/**
 * Opaque capability token. The constructor is private — the only way to
 * obtain one is {@link SandboxPricedCallToken.mint}, which requires proof the
 * caller holds a sandbox-mode config.
 */
export class SandboxPricedCallToken {
  /** Branding so a structural `{}` cannot masquerade as a token. */
  readonly #brand = true

  private constructor() {
    // Intentionally empty; access `#brand` so the field is retained.
    void this.#brand
  }

  /**
   * Mint a token. Sandbox-scoped at the point of minting: refuses anything
   * but a `mode: 'sandbox'` config. Invoked only by `createSandboxEpsCallDeps`
   * when the harness explicitly opts in.
   */
  static mint(proof: { mode: 'sandbox' | 'production' }): SandboxPricedCallToken {
    if (proof.mode !== 'sandbox') {
      throw new Error(
        `SandboxPricedCallToken.mint refuses a non-sandbox config (mode='${proof.mode}'). The truth-gate block bypass is sandbox-only.`,
      )
    }
    return new SandboxPricedCallToken()
  }
}

/**
 * Branded typeguard — true only for a genuine minted token, never for a
 * shape-only object. Safe to expose to `initialise-order.ts`: it grants no
 * minting capability.
 */
export function isSandboxPricedCallToken(value: unknown): value is SandboxPricedCallToken {
  return value instanceof SandboxPricedCallToken
}

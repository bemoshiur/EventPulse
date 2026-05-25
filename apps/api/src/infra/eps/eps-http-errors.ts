/**
 * EPS HTTP error classes — Day 26 Part 2 additions to the three
 * existing Part-1 classes (`StagingPaymentBlockedError`,
 * `EpsConfigError`, `EpsNotImplementedError`). These represent the
 * NEW failure modes a real HTTP wire-up can hit:
 *
 *   - `EpsNetworkError` — the request never reached EPS, or no usable
 *     response came back (connection refused, DNS, timeout, TLS).
 *   - `EpsResponseError` — EPS returned a response we cannot
 *     interpret: non-2xx status, missing required body fields, body
 *     fails zod validation, or unknown status alias the
 *     normalise-status shim cannot collapse.
 *
 * Both are distinct from each other AND from the three Part-1
 * classes so callers (and `/review`) can grep + branch precisely
 * per `.claude/memory/decisions.md` "Three distinct greppable EPS
 * error classes" (2026-05-25) — same pattern, expanded.
 *
 * NO PII is captured on these errors per §1.3 R5. The `requestId`
 * field is a callee-generated correlation id, NOT an EPS-side id.
 */

/**
 * Network-layer failure: connection refused, DNS, timeout, TLS, or
 * any other condition where no parseable HTTP response was received.
 *
 * Callers should NOT auto-retry blindly — EPS gateway calls move
 * money; retry semantics are caller-specific (the Day 27 callback
 * handler decides; the Day-26 order creation endpoint deliberately
 * does NOT retry on init failure — the order persists in
 * `awaiting_payment` and the user sees the failure path).
 */
export class EpsNetworkError extends Error {
  public override readonly cause: unknown
  public readonly requestId: string | undefined

  constructor(message: string, cause: unknown, requestId?: string) {
    super(message)
    this.name = 'EpsNetworkError'
    this.cause = cause
    this.requestId = requestId
  }
}

/**
 * EPS returned something but we cannot interpret it. Causes:
 *   - HTTP status outside 2xx
 *   - response body fails zod validation (missing required fields,
 *     wrong types)
 *   - status alias the normalise-status shim does NOT recognise
 *   - response shape entirely absent (empty body, HTML page, etc.)
 *
 * The `httpStatus` field is captured when available; `null` when the
 * failure is post-response (body-parse / validation).
 *
 * The `epsCode` / `epsMessage` fields are EPS's own error code +
 * message strings when the response carries them — useful for
 * diagnosis without forcing callers to parse the raw body.
 */
export class EpsResponseError extends Error {
  public readonly httpStatus: number | null
  public readonly epsCode: string | null
  public readonly epsMessage: string | null
  public readonly requestId: string | undefined

  constructor(
    message: string,
    options: {
      httpStatus?: number | null
      epsCode?: string | null
      epsMessage?: string | null
      requestId?: string
    } = {},
  ) {
    super(message)
    this.name = 'EpsResponseError'
    this.httpStatus = options.httpStatus ?? null
    this.epsCode = options.epsCode ?? null
    this.epsMessage = options.epsMessage ?? null
    this.requestId = options.requestId
  }
}

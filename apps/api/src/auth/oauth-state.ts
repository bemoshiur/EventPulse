/**
 * OAuth state cookie — HMAC-signed, TTL-bounded, single-use.
 *
 * Plumbing for the OAuth callback flow per CLAUDE.md §5.2. Between
 * `/oauth/<provider>/start` and `/oauth/<provider>/callback`, we need
 * to remember:
 *
 *   - the random state nonce we sent to the IdP (prevents CSRF)
 *   - the PKCE code verifier (Google only) so we can complete the exchange
 *   - which provider issued this state (defence in depth: cookie won't
 *     be honoured if delivered to the wrong callback route)
 *   - an absolute expiry (defence in depth on top of cookie Max-Age)
 *
 * We sign the payload with HMAC-SHA256 using a key DERIVED from
 * JWT_ACCESS_SECRET via a domain-separation tag, so a leaked session
 * JWT secret can't be used to forge an OAuth state and vice-versa.
 *
 * Single-use: the callback handler clears the cookie before any DB
 * write. If a cookie is replayed, the IdP code will already have been
 * consumed (codes are one-time on the IdP side), so the flow fails
 * closed.
 *
 * Format on the wire: `<base64url(payload-json)>.<base64url(hmac)>`.
 * Compact, opaque to the browser, easy to verify in constant time.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export interface OAuthStatePayload {
  /** Random nonce we'll match against the IdP's `state` query param. */
  state: string
  /** PKCE code verifier (Google only). Empty string for Apple. */
  codeVerifier: string
  /** Which provider this state was minted for. */
  provider: 'google' | 'apple'
  /** Unix seconds at which this payload becomes invalid. */
  exp: number
}

/** Default TTL — 10 minutes is plenty for an OAuth round-trip. */
export const DEFAULT_STATE_TTL_SEC = 600

/** Cookie name per provider. */
export function stateCookieName(provider: 'google' | 'apple'): string {
  return `oauth_state_${provider}`
}

/**
 * Derive the HMAC key from JWT_ACCESS_SECRET with a domain-separation
 * tag so a leak of one secret doesn't compromise the other. We never
 * read the OAuth state HMAC key from its own env var — one fewer
 * secret to rotate and keep in sync.
 */
export function deriveStateHmacKey(jwtAccessSecret: string): Buffer {
  if (jwtAccessSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 characters to derive OAuth state key')
  }
  return createHmac('sha256', jwtAccessSecret).update('oauth-state-v1').digest()
}

function readKey(): Buffer {
  const raw = process.env['JWT_ACCESS_SECRET']
  if (!raw) throw new Error('JWT_ACCESS_SECRET is not set')
  return deriveStateHmacKey(raw)
}

/**
 * Sign an OAuth state payload. Returns the cookie value to set.
 *
 * `nowSec` is injectable for tests; defaults to current time.
 */
export function signState(
  payload: Omit<OAuthStatePayload, 'exp'>,
  opts: { ttlSec?: number; nowSec?: number; key?: Buffer } = {},
): string {
  const exp =
    (opts.nowSec ?? Math.floor(Date.now() / 1000)) + (opts.ttlSec ?? DEFAULT_STATE_TTL_SEC)
  const full: OAuthStatePayload = { ...payload, exp }
  const json = JSON.stringify(full)
  const b64 = Buffer.from(json, 'utf8').toString('base64url')
  const key = opts.key ?? readKey()
  const sig = createHmac('sha256', key).update(b64).digest('base64url')
  return `${b64}.${sig}`
}

export type VerifyStateError =
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'provider_mismatch'
  | 'invalid_payload'

export interface VerifyStateOk {
  ok: true
  payload: OAuthStatePayload
}
export interface VerifyStateErr {
  ok: false
  error: VerifyStateError
}
export type VerifyStateResult = VerifyStateOk | VerifyStateErr

/**
 * Verify a cookie value against the expected provider and a state
 * nonce returned by the IdP. Returns a discriminated union so callers
 * surface specific failure modes in logs without leaking detail to the
 * client (the caller should respond with a generic 400 either way).
 */
export function verifyState(
  cookieValue: string | undefined | null,
  expectedProvider: 'google' | 'apple',
  expectedState: string | undefined | null,
  opts: { nowSec?: number; key?: Buffer } = {},
): VerifyStateResult {
  if (!cookieValue) return { ok: false, error: 'malformed' }
  const parts = cookieValue.split('.')
  if (parts.length !== 2) return { ok: false, error: 'malformed' }
  const [b64, sig] = parts as [string, string]
  if (!b64 || !sig) return { ok: false, error: 'malformed' }

  // Verify signature in constant time before touching the payload.
  const key = opts.key ?? readKey()
  const expected = createHmac('sha256', key).update(b64).digest()
  let actual: Buffer
  try {
    actual = Buffer.from(sig, 'base64url')
  } catch {
    return { ok: false, error: 'malformed' }
  }
  if (actual.length !== expected.length) {
    return { ok: false, error: 'bad_signature' }
  }
  if (!timingSafeEqual(actual, expected)) {
    return { ok: false, error: 'bad_signature' }
  }

  let payload: OAuthStatePayload
  try {
    const json = Buffer.from(b64, 'base64url').toString('utf8')
    payload = JSON.parse(json) as OAuthStatePayload
  } catch {
    return { ok: false, error: 'malformed' }
  }
  if (
    typeof payload?.state !== 'string' ||
    typeof payload?.codeVerifier !== 'string' ||
    typeof payload?.exp !== 'number' ||
    (payload.provider !== 'google' && payload.provider !== 'apple')
  ) {
    return { ok: false, error: 'invalid_payload' }
  }

  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)
  if (payload.exp <= now) {
    return { ok: false, error: 'expired' }
  }
  if (payload.provider !== expectedProvider) {
    return { ok: false, error: 'provider_mismatch' }
  }
  if (!expectedState || payload.state !== expectedState) {
    return { ok: false, error: 'bad_signature' }
  }

  return { ok: true, payload }
}

/**
 * Build the Set-Cookie value for the OAuth state. Caller passes
 * `secure` based on environment (true in prod, false in local dev
 * where HTTPS isn't available).
 */
export function buildSetCookie(
  cookieName: string,
  cookieValue: string,
  opts: { secure: boolean; ttlSec?: number } = { secure: false },
): string {
  const maxAge = opts.ttlSec ?? DEFAULT_STATE_TTL_SEC
  const segments = [
    `${cookieName}=${cookieValue}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge}`,
  ]
  if (opts.secure) segments.push('Secure')
  return segments.join('; ')
}

/** Build a Set-Cookie that clears the cookie (Max-Age=0). */
export function buildClearCookie(cookieName: string, opts: { secure: boolean }): string {
  const segments = [`${cookieName}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0']
  if (opts.secure) segments.push('Secure')
  return segments.join('; ')
}

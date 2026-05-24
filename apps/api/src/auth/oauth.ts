/**
 * Google OAuth/OIDC client per CLAUDE.md §5.2.
 *
 * Uses `arctic` for the PKCE/state plumbing.
 *
 * Apple Sign-In was DROPPED from MVP scope Sprint 3 Day 23 — see
 * decisions.md "Apple Sign-In dropped from MVP scope". Apple client +
 * verifier + JWKS removed; reinstate via dedicated PR (the prior
 * implementation is in git history of this file).
 *
 * Env vars required for runtime:
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
 *
 * Construction is lazy so unit tests can run without these set.
 */

import { Google } from 'arctic'

let _google: Google | undefined

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

function baseUrl(): string {
  return process.env['EVENTPULSE_API_BASE_URL'] ?? 'http://localhost:4000'
}

/**
 * Returns true when all env vars required to construct the Google OAuth
 * client are present + non-empty.
 *
 * The `start` route handler in `routes/oauth-routes.ts` uses this to
 * decide whether to return a clean 503 OAUTH_NOT_CONFIGURED — instead
 * of crashing the request with `requireEnv` throwing inside the client
 * constructor. Lets the sign-in surface ship before credential
 * procurement completes; the button hits the start endpoint, the
 * endpoint returns 503, the frontend can surface a friendly message.
 *
 * Day 20 added this guard so OAuth credential provisioning could lag
 * behind the sign-in UI without breaking the staging deploy. See
 * `.claude/memory/gotchas.md` "OAuth button hrefs pointed at web vhost
 * instead of API vhost" for the wider context.
 *
 * Signature retains the `provider` parameter (Google-only literal) so
 * the call-site shape survives future provider re-introduction without
 * needing to rewrite every call.
 */
export function isOAuthProviderConfigured(provider: 'google'): boolean {
  void provider
  return Boolean(
    process.env['GOOGLE_OAUTH_CLIENT_ID'] && process.env['GOOGLE_OAUTH_CLIENT_SECRET'],
  )
}

export function googleClient(): Google {
  if (_google) return _google
  _google = new Google(
    requireEnv('GOOGLE_OAUTH_CLIENT_ID'),
    requireEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    `${baseUrl()}/api/v1/auth/oauth/google/callback`,
  )
  return _google
}

/** For tests: reset memoised clients so env changes between tests take effect. */
export function _resetOAuthClients(): void {
  _google = undefined
}

// ─── ID-token verification (Sprint 2 Item 4) ──────────────────────────
//
// Google returns a signed ID token (JWT) on the OAuth callback. We
// verify the signature against the IdP's JWKS endpoint before trusting
// any claim — never call `decodeIdToken` and use the claims directly,
// that's how OAuth account-takeover attacks happen.

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs')

let _googleJwks: ReturnType<typeof createRemoteJWKSet> | undefined

function googleJwks() {
  if (!_googleJwks) _googleJwks = createRemoteJWKSet(GOOGLE_JWKS_URL)
  return _googleJwks
}

export interface GoogleIdClaims {
  sub: string
  email: string
  emailVerified: boolean
  name: string | null
  picture: string | null
  raw: JWTPayload
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdClaims> {
  const clientId = process.env['GOOGLE_OAUTH_CLIENT_ID']
  if (!clientId) throw new Error('GOOGLE_OAUTH_CLIENT_ID is not set')
  const { payload } = await jwtVerify(idToken, googleJwks(), {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId,
  })
  const sub = payload.sub
  const email = typeof payload['email'] === 'string' ? (payload['email'] as string) : ''
  const emailVerified = payload['email_verified'] === true || payload['email_verified'] === 'true'
  const name = typeof payload['name'] === 'string' ? (payload['name'] as string) : null
  const picture = typeof payload['picture'] === 'string' ? (payload['picture'] as string) : null
  if (!sub) throw new Error('Google ID token missing sub')
  if (!email) throw new Error('Google ID token missing email')
  return { sub, email: email.toLowerCase(), emailVerified, name, picture, raw: payload }
}

// ─── Auto-link decision (Sprint 2 Item 4) ─────────────────────────────
//
// Pure function — encapsulates the "should we auto-link this OAuth
// identity to an existing user, or create a new one" decision so it
// can be unit-tested without touching the network or the database.
//
// `isPrivateEmail` retained on the input shape for forward-compat with
// providers whose verified-email is a per-app relay token (the original
// Apple-driven concern). For Google-only today, callers pass `false`.

export type AutoLinkDecision =
  | { action: 'link-to-existing'; reason: 'verified-email-match' }
  | {
      action: 'create-new-user'
      reason: 'no-match' | 'relay-email-not-linkable' | 'email-not-verified'
    }

export interface AutoLinkDecisionInput {
  /** Verified provider identifier (Google `sub`). */
  providerUserId: string
  /** Provider-returned email (lowercased, or null if not provided). */
  email: string | null
  /** IdP-asserted verification. */
  emailVerified: boolean
  /** True means `email` is a per-app relay token, NOT user's real address.
   *  Reserved for future providers (e.g. re-introduced Apple); for
   *  Google callers pass false. */
  isPrivateEmail: boolean
  /** Does a user already exist with this email? Caller does the lookup. */
  existingUserWithEmailId: string | null
}

export function decideAutoLink(input: AutoLinkDecisionInput): AutoLinkDecision {
  // Relay emails can be rotated by the IdP at any time and are not a
  // stable identity for the human; matching by relay would link the
  // wrong account. Never auto-link on a relay address — always new user.
  if (input.isPrivateEmail) {
    return { action: 'create-new-user', reason: 'relay-email-not-linkable' }
  }
  if (!input.emailVerified || !input.email) {
    return { action: 'create-new-user', reason: 'email-not-verified' }
  }
  if (input.existingUserWithEmailId) {
    return { action: 'link-to-existing', reason: 'verified-email-match' }
  }
  return { action: 'create-new-user', reason: 'no-match' }
}

/** For tests: reset memoised JWKS so env changes between tests take effect. */
export function _resetJwks(): void {
  _googleJwks = undefined
}

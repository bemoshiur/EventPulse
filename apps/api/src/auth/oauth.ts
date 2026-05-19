/**
 * Google + Apple OAuth/OIDC clients per CLAUDE.md §5.2.
 *
 * Uses `arctic` for the PKCE/state plumbing. Apple's "Sign in with
 * Apple" is also OIDC but requires a JWT-based client_secret minted
 * from the team's private key — arctic handles that internally as long
 * as we pass the right values.
 *
 * Env vars required for runtime (validate via env.ts):
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
 *   APPLE_OAUTH_CLIENT_ID  (Services ID, e.g. com.eventpulse.signin)
 *   APPLE_OAUTH_TEAM_ID, APPLE_OAUTH_KEY_ID, APPLE_OAUTH_PRIVATE_KEY
 *
 * Construction is lazy so unit tests can run without these set.
 */

import { Apple, Google } from 'arctic'

let _google: Google | undefined
let _apple: Apple | undefined

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

function baseUrl(): string {
  return process.env['EVENTPULSE_API_BASE_URL'] ?? 'http://localhost:4000'
}

/**
 * Returns true when all env vars required to construct the OAuth client
 * for `provider` are present + non-empty.
 *
 * The `start` route handlers in `routes/oauth-routes.ts` use this to
 * decide whether to return a clean 503 OAUTH_NOT_CONFIGURED — instead
 * of crashing the request with `requireEnv` throwing inside the client
 * constructor. Lets the sign-in surface ship before credential
 * procurement completes; the buttons hit the start endpoint, the
 * endpoint returns 503, the frontend can surface a friendly message.
 *
 * Day 20 added this guard so OAuth credential provisioning could lag
 * behind the sign-in UI without breaking the staging deploy. See
 * `.claude/memory/gotchas.md` "OAuth button hrefs pointed at web vhost
 * instead of API vhost" for the wider context.
 */
export function isOAuthProviderConfigured(provider: 'google' | 'apple'): boolean {
  if (provider === 'google') {
    return Boolean(
      process.env['GOOGLE_OAUTH_CLIENT_ID'] && process.env['GOOGLE_OAUTH_CLIENT_SECRET'],
    )
  }
  return Boolean(
    process.env['APPLE_OAUTH_CLIENT_ID'] &&
    process.env['APPLE_OAUTH_TEAM_ID'] &&
    process.env['APPLE_OAUTH_KEY_ID'] &&
    process.env['APPLE_OAUTH_PRIVATE_KEY'],
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

/**
 * Decode the Apple private key from APPLE_OAUTH_PRIVATE_KEY.
 *
 * Two accepted forms — auto-detected by the leading bytes:
 *   - Raw PEM (starts with `-----BEGIN`): used in local dev where the
 *     env file is hand-edited and multi-line PEM values can be pasted
 *     in via shell-quoting.
 *   - Base64-encoded PEM: used in staging/prod, where the env file is
 *     materialised by `bootstrap-staging.sh` from Secrets Manager.
 *     Single-line representation survives the bash cat-heredoc + Node
 *     env-file parse safely; multi-line PEMs would break either of
 *     those layers.
 */
function decodeApplePrivateKey(): string {
  const raw = requireEnv('APPLE_OAUTH_PRIVATE_KEY')
  if (raw.startsWith('-----BEGIN')) return raw
  return Buffer.from(raw, 'base64').toString('utf-8')
}

export function appleClient(): Apple {
  if (_apple) return _apple
  // arctic's Apple expects: clientId (Services ID), teamId, keyId, certificate (private key PEM)
  _apple = new Apple(
    requireEnv('APPLE_OAUTH_CLIENT_ID'),
    requireEnv('APPLE_OAUTH_TEAM_ID'),
    requireEnv('APPLE_OAUTH_KEY_ID'),
    new TextEncoder().encode(decodeApplePrivateKey()),
    `${baseUrl()}/api/v1/auth/oauth/apple/callback`,
  )
  return _apple
}

/** For tests: reset memoised clients so env changes between tests take effect. */
export function _resetOAuthClients(): void {
  _google = undefined
  _apple = undefined
}

// ─── ID-token verification (Sprint 2 Item 4) ──────────────────────────
//
// Google and Apple both return a signed ID token (JWT) on the OAuth
// callback. We verify the signature against the IdP's JWKS endpoint
// before trusting any claim — never call `decodeIdToken` and use the
// claims directly, that's how OAuth account-takeover attacks happen.
//
// Apple's `is_private_email` claim is the relay flag; when true, the
// `email` is a per-app rotation token like `abc@privaterelay.appleid.com`,
// not the user's real address. Auto-link by email MUST refuse to match
// on relay addresses; the per-user identifier is `sub` (Apple-stable).

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs')
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys')

let _googleJwks: ReturnType<typeof createRemoteJWKSet> | undefined
let _appleJwks: ReturnType<typeof createRemoteJWKSet> | undefined

function googleJwks() {
  if (!_googleJwks) _googleJwks = createRemoteJWKSet(GOOGLE_JWKS_URL)
  return _googleJwks
}

function appleJwks() {
  if (!_appleJwks) _appleJwks = createRemoteJWKSet(APPLE_JWKS_URL)
  return _appleJwks
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

export interface AppleIdClaims {
  sub: string
  email: string | null
  emailVerified: boolean
  /** true when `email` is a per-app relay token, NOT the user's real address. */
  isPrivateEmail: boolean
  raw: JWTPayload
}

export async function verifyAppleIdToken(idToken: string): Promise<AppleIdClaims> {
  const clientId = process.env['APPLE_OAUTH_CLIENT_ID']
  if (!clientId) throw new Error('APPLE_OAUTH_CLIENT_ID is not set')
  const { payload } = await jwtVerify(idToken, appleJwks(), {
    issuer: 'https://appleid.apple.com',
    audience: clientId,
  })
  const sub = payload.sub
  const email = typeof payload['email'] === 'string' ? (payload['email'] as string) : null
  const emailVerified = payload['email_verified'] === true || payload['email_verified'] === 'true'
  const isPrivateEmail =
    payload['is_private_email'] === true || payload['is_private_email'] === 'true'
  if (!sub) throw new Error('Apple ID token missing sub')
  return {
    sub,
    email: email ? email.toLowerCase() : null,
    emailVerified,
    isPrivateEmail,
    raw: payload,
  }
}

// ─── Auto-link decision (Sprint 2 Item 4) ─────────────────────────────
//
// Pure function — encapsulates the "should we auto-link this OAuth
// identity to an existing user, or create a new one" decision so it
// can be unit-tested without touching the network or the database.

export type AutoLinkDecision =
  | { action: 'link-to-existing'; reason: 'verified-email-match' }
  | {
      action: 'create-new-user'
      reason: 'no-match' | 'relay-email-not-linkable' | 'email-not-verified'
    }

export interface AutoLinkDecisionInput {
  /** Verified provider identifier (Google/Apple `sub`). */
  providerUserId: string
  /** Provider-returned email (lowercased, or null if not provided). */
  email: string | null
  /** IdP-asserted verification. */
  emailVerified: boolean
  /** Apple-only: true means `email` is a relay token, NOT user's real address. */
  isPrivateEmail: boolean
  /** Does a user already exist with this email? Caller does the lookup. */
  existingUserWithEmailId: string | null
}

export function decideAutoLink(input: AutoLinkDecisionInput): AutoLinkDecision {
  // Apple relay emails can be rotated by Apple at any time and are not
  // a stable identity for the human; matching by relay would link the
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
  _appleJwks = undefined
}

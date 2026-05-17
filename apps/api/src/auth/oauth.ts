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

export function googleClient(): Google {
  if (_google) return _google
  _google = new Google(
    requireEnv('GOOGLE_OAUTH_CLIENT_ID'),
    requireEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    `${baseUrl()}/api/v1/auth/oauth/google/callback`,
  )
  return _google
}

export function appleClient(): Apple {
  if (_apple) return _apple
  // arctic's Apple expects: clientId (Services ID), teamId, keyId, certificate (private key PEM)
  _apple = new Apple(
    requireEnv('APPLE_OAUTH_CLIENT_ID'),
    requireEnv('APPLE_OAUTH_TEAM_ID'),
    requireEnv('APPLE_OAUTH_KEY_ID'),
    new TextEncoder().encode(requireEnv('APPLE_OAUTH_PRIVATE_KEY')),
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

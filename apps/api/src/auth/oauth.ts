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

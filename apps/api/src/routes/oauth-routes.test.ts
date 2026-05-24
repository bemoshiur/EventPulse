import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../app.js'
import { _resetOAuthClients } from '../auth/oauth.js'
import { postSignInUrl } from './oauth-routes.js'

/**
 * Route-shape tests for OAuth callbacks. Focus is on the predicates we
 * own — state cookie verification, the failure-closed contract on
 * missing/bad state.
 *
 * Successful end-to-end flows require Google as a live IdP and are
 * tested manually in staging once the OAuth credentials are configured.
 * Mocking arctic + JWKS here would be more scaffolding than signal.
 *
 * Apple Sign-In was DROPPED from MVP scope Sprint 3 Day 23 — see
 * decisions.md "Apple Sign-In dropped from MVP scope". Apple route +
 * Apple-specific test cases removed. Reachability of the (now-removed)
 * paths is verified by the "apple routes are gone" guard test below
 * so a future copy-paste regression that re-adds them surfaces here.
 *
 * What this file DOES NOT test:
 *   - validateAuthorizationCode against a real IdP (manual staging)
 *   - jose.jwtVerify against a real JWKS (manual staging)
 *   - The auto-link DB write path (covered by decideAutoLink + the
 *     RLS test suite separately)
 */

beforeAll(() => {
  // The /start handler requires OAuth env to construct the arctic
  // client. Set test values so the lazy construction doesn't throw —
  // these are never sent to a real IdP in these tests.
  process.env['GOOGLE_OAUTH_CLIENT_ID'] = 'test-google-client-id'
  process.env['GOOGLE_OAUTH_CLIENT_SECRET'] = 'test-google-client-secret'
  process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
  process.env['EVENTPULSE_API_BASE_URL'] = 'http://localhost:4000'
})

afterEach(() => {
  _resetOAuthClients()
})

describe('OAuth /start routes', () => {
  it('GET /api/v1/auth/oauth/google/start returns 302 to Google with a state cookie', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/auth/oauth/google/start')
    expect(res.status).toBe(302)
    const location = res.headers.get('location')
    expect(location).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2/)
    expect(location).toContain('client_id=test-google-client-id')
    expect(location).toContain('code_challenge')
    expect(location).toContain('state=')
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie!).toContain('oauth_state_google=')
    expect(setCookie!).toContain('HttpOnly')
    expect(setCookie!).toContain('SameSite=Lax')
  })
})

describe('OAuth /start 503 when provider not configured (Day 20)', () => {
  it('GET google/start returns 503 OAUTH_NOT_CONFIGURED when client id missing', async () => {
    const saved = process.env['GOOGLE_OAUTH_CLIENT_ID']
    delete process.env['GOOGLE_OAUTH_CLIENT_ID']
    _resetOAuthClients()
    try {
      const app = createApp()
      const res = await app.request('/api/v1/auth/oauth/google/start')
      expect(res.status).toBe(503)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('OAUTH_NOT_CONFIGURED')
      expect(body.error.message).toMatch(/Google sign-in is not configured/)
    } finally {
      if (saved !== undefined) process.env['GOOGLE_OAUTH_CLIENT_ID'] = saved
      _resetOAuthClients()
    }
  })
})

describe('OAuth /callback failure-closed paths', () => {
  it('GET google/callback with NO state cookie → 400', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/auth/oauth/google/callback?code=test&state=foo')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; _internal_reason?: string } }
    expect(body.error.code).toBe('OAUTH_CALLBACK_FAILED')
    expect(body.error._internal_reason).toMatch(/^state:/)
  })

  it('GET google/callback with MISMATCHED state cookie → 400', async () => {
    const app = createApp()
    // Cookie says state=A; query says state=B → bad_signature
    const fakeCookie = 'oauth_state_google=eyJ.bogus'
    const res = await app.request('/api/v1/auth/oauth/google/callback?code=test&state=mismatch', {
      headers: { cookie: fakeCookie },
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { _internal_reason?: string } }
    expect(body.error._internal_reason).toMatch(/^state:/)
  })

  it('GET google/callback?error=access_denied → 400 (IdP-side failure)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/auth/oauth/google/callback?error=access_denied')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { _internal_reason?: string } }
    expect(body.error._internal_reason).toBe('idp_error:access_denied')
  })

  it('GET google/callback with neither code nor state → 400', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/auth/oauth/google/callback')
    expect(res.status).toBe(400)
  })

  it('callback clears the state cookie on failure (single-use enforcement)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/auth/oauth/google/callback')
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie!).toContain('oauth_state_google=')
    expect(setCookie!).toContain('Max-Age=0')
  })
})

describe('postSignInUrl (Day 24 redirect fix)', () => {
  // Locks the post-sign-in redirect target shape against regression to a
  // relative path (which would resolve against the api vhost and 404) or
  // to a non-web-vhost. The OAuth callback post-Day-24 returns 302 here
  // instead of 200 + JSON body; if anyone reverts the redirect or
  // changes the target shape, these tests fire loud.

  const ORIGINAL = process.env['EVENTPULSE_WEB_BASE_URL']
  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env['EVENTPULSE_WEB_BASE_URL']
    } else {
      process.env['EVENTPULSE_WEB_BASE_URL'] = ORIGINAL
    }
  })

  it('returns absolute URL with EVENTPULSE_WEB_BASE_URL prefix when set', () => {
    process.env['EVENTPULSE_WEB_BASE_URL'] = 'https://staging.eventpulse.com.bd'
    const target = postSignInUrl()
    expect(target).toBe('https://staging.eventpulse.com.bd/?signed_in=1')
    // Defence against regression to relative path (the original Day 23
    // OAuth-button bug class).
    expect(target).not.toMatch(/^\/[^/]/)
  })

  it('strips trailing slash from the base URL before appending', () => {
    process.env['EVENTPULSE_WEB_BASE_URL'] = 'https://staging.eventpulse.com.bd/'
    expect(postSignInUrl()).toBe('https://staging.eventpulse.com.bd/?signed_in=1')
  })

  it('falls back to localhost:3000 when EVENTPULSE_WEB_BASE_URL is unset', () => {
    delete process.env['EVENTPULSE_WEB_BASE_URL']
    expect(postSignInUrl()).toBe('http://localhost:3000/?signed_in=1')
  })

  it('appends the `signed_in=1` query so apex page can branch on it', () => {
    process.env['EVENTPULSE_WEB_BASE_URL'] = 'https://example.test'
    expect(postSignInUrl()).toContain('?signed_in=1')
  })
})

describe('Apple Sign-In removal guard (Sprint 3 Day 23)', () => {
  // Locks in the "Apple is gone" decision against future copy-paste
  // regressions. If a future PR re-adds Apple routes piecemeal, these
  // tests fail — at which point the re-introduction has to be a
  // deliberate decision recorded in decisions.md, not an accident.

  it('GET /api/v1/auth/oauth/apple/start returns 404 (route removed)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/auth/oauth/apple/start')
    expect(res.status).toBe(404)
  })

  it('POST /api/v1/auth/oauth/apple/callback returns 404 (route removed)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/auth/oauth/apple/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=test&state=foo',
    })
    expect(res.status).toBe(404)
  })
})

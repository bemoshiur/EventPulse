import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../app.js'
import { _resetOAuthClients } from '../auth/oauth.js'

/**
 * Route-shape tests for OAuth callbacks. Focus is on the predicates we
 * own — state cookie verification, Apple's response-mode (POST), the
 * failure-closed contract on missing/bad state.
 *
 * Successful end-to-end flows require Google/Apple as live IdPs and
 * are tested manually in staging once the OAuth credentials are
 * configured. Mocking arctic + JWKS here would be more scaffolding
 * than signal.
 *
 * What this file DOES NOT test:
 *   - validateAuthorizationCode against a real IdP (manual staging)
 *   - jose.jwtVerify against a real JWKS (manual staging)
 *   - The auto-link DB write path (covered by decideAutoLink + the
 *     RLS test suite separately)
 */

beforeAll(() => {
  // The /start handlers require OAuth env to construct the arctic
  // clients. Set test values so the lazy construction doesn't throw —
  // these are never sent to a real IdP in these tests.
  process.env['GOOGLE_OAUTH_CLIENT_ID'] = 'test-google-client-id'
  process.env['GOOGLE_OAUTH_CLIENT_SECRET'] = 'test-google-client-secret'
  process.env['APPLE_OAUTH_CLIENT_ID'] = 'com.eventpulse.test'
  process.env['APPLE_OAUTH_TEAM_ID'] = 'TESTTEAM01'
  process.env['APPLE_OAUTH_KEY_ID'] = 'TESTKEY001'
  // arctic's Apple wants a PEM-formatted private key. We supply a
  // syntactically-valid PEM so the constructor doesn't blow up.
  // It will never sign anything in these tests (we only exercise
  // /start which builds a URL, and /callback failure paths that
  // bail before signing).
  process.env['APPLE_OAUTH_PRIVATE_KEY'] =
    '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIBzWcVS4kF8VMz3FEX9rqoH8h6Ml+VgQVl4FNQz0BIv4\n-----END PRIVATE KEY-----'
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

  it('GET /api/v1/auth/oauth/apple/start returns 302 to Apple with response_mode=form_post', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/auth/oauth/apple/start')
    expect(res.status).toBe(302)
    const location = res.headers.get('location')
    expect(location).toMatch(/^https:\/\/appleid\.apple\.com\/auth\/authorize/)
    expect(location).toContain('response_mode=form_post')
    expect(location).toContain('state=')
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie!).toContain('oauth_state_apple=')
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

  it('GET apple/start returns 503 OAUTH_NOT_CONFIGURED when team id missing', async () => {
    const saved = process.env['APPLE_OAUTH_TEAM_ID']
    delete process.env['APPLE_OAUTH_TEAM_ID']
    _resetOAuthClients()
    try {
      const app = createApp()
      const res = await app.request('/api/v1/auth/oauth/apple/start')
      expect(res.status).toBe(503)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('OAUTH_NOT_CONFIGURED')
      expect(body.error.message).toMatch(/Apple sign-in is not configured/)
    } finally {
      if (saved !== undefined) process.env['APPLE_OAUTH_TEAM_ID'] = saved
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

  it('POST apple/callback with NO state cookie → 400', async () => {
    const app = createApp()
    const form = new URLSearchParams({ code: 'test', state: 'foo' })
    const res = await app.request('/api/v1/auth/oauth/apple/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { _internal_reason?: string } }
    expect(body.error._internal_reason).toMatch(/^state:/)
  })

  it('POST apple/callback?error=user_cancelled_authorize → 400 (IdP-side failure)', async () => {
    const app = createApp()
    const form = new URLSearchParams({ error: 'user_cancelled_authorize' })
    const res = await app.request('/api/v1/auth/oauth/apple/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { _internal_reason?: string } }
    expect(body.error._internal_reason).toBe('idp_error:user_cancelled_authorize')
  })

  it('GET to /apple/callback (wrong method — Apple uses POST) returns 404', async () => {
    // Hono returns 404 when the method doesn't match. This documents
    // that Apple callbacks are POST-only — a GET shouldn't accidentally
    // start a flow.
    const app = createApp()
    const res = await app.request('/api/v1/auth/oauth/apple/callback?code=test&state=foo')
    expect(res.status).toBe(404)
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

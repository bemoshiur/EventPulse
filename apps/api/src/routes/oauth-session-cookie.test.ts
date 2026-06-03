/**
 * OAuth callback session-cookie regression guard.
 *
 * The Google callback sets the post-login session cookie. PR #270 renamed the
 * session cookie to `ep_session` (SESSION_COOKIE_NAME) and pointed the auth
 * middleware at it via readSessionCookie — but the OAuth callback was missed
 * and kept setting the OLD `eventpulse_session`, which nothing reads. Result:
 * Google login completed but the user was never authenticated ("Google login
 * is not working", Day 47). The existing oauth-routes.test.ts deliberately
 * skips the success path ("require Google as a live IdP"), so nothing caught it.
 *
 * This test drives the success path with the IdP + DB boundaries mocked (no
 * real Google, no DB) and asserts the response sets `ep_session` — the same
 * name the middleware reads.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../auth/oauth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/oauth.js')>()
  return {
    ...actual,
    isOAuthProviderConfigured: () => true,
    googleClient: () => ({
      validateAuthorizationCode: async () => ({ idToken: () => 'fake-id-token' }),
    }),
    verifyGoogleIdToken: async () => ({
      sub: 'google-sub-123',
      email: 'oauth-user@example.test',
      emailVerified: true,
      name: 'OAuth User',
      picture: null,
    }),
  }
})

vi.mock('../auth/users.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/users.js')>()
  return {
    ...actual,
    // signed-in-existing path — the simplest branch, no DB writes.
    findUserByOAuthIdentity: vi.fn(async () => ({
      user: { id: 'user-1', email: 'oauth-user@example.test', fullName: 'OAuth User' },
    })),
  }
})

vi.mock('../auth/sessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/sessions.js')>()
  return {
    ...actual,
    createSession: vi.fn(async () => ({
      token: 'oauth-session-token',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })),
  }
})

import { createApp } from '../app.js'
import { signState, stateCookieName } from '../auth/oauth-state.js'

beforeAll(() => {
  process.env['GOOGLE_OAUTH_CLIENT_ID'] = 'test-google-client-id'
  process.env['GOOGLE_OAUTH_CLIENT_SECRET'] = 'test-google-client-secret'
  process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
  process.env['JWT_REFRESH_SECRET'] = 'y'.repeat(64)
  process.env['EVENTPULSE_API_BASE_URL'] = 'http://localhost:4000'
  process.env['EVENTPULSE_WEB_BASE_URL'] = 'https://app.eventpulse.com.bd'
})

const STATE = 'test-state-value'

function callbackRequest() {
  const stateCookie = signState({ state: STATE, codeVerifier: 'test-verifier', provider: 'google' })
  return createApp().request(`/api/v1/auth/oauth/google/callback?code=test-code&state=${STATE}`, {
    headers: { cookie: `${stateCookieName('google')}=${stateCookie}` },
  })
}

describe('Google OAuth callback — session cookie', () => {
  it('sets the canonical `ep_session` cookie the middleware reads (NOT the legacy eventpulse_session)', async () => {
    const res = await callbackRequest()
    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some((c) => c.startsWith('ep_session='))).toBe(true)
    expect(setCookies.some((c) => c.startsWith('eventpulse_session='))).toBe(false)
  })

  it('redirects (302) after a successful login', async () => {
    const res = await callbackRequest()
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('eventpulse.com.bd')
  })
})

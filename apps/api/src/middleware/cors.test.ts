/**
 * CORS preflight tests — browser-auth integration step 1 (Day 46).
 *
 * The portals (app/admin/my.eventpulse.com.bd) call the API cross-origin
 * with `credentials: 'include'`. Without CORS the browser blocks every
 * authenticated call at preflight. These assert the API echoes ONLY
 * allow-listed portal origins (never `*` under credentials mode) and
 * sets Allow-Credentials. See docs/design/browser-auth-integration.md §5.1.
 *
 * Header-only assertions — no DB needed (preflight short-circuits the
 * route handler; CORS headers are added by middleware regardless of status).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../app.js'
import { allowedOrigins } from './cors.js'

const ALLOWED = 'https://app.eventpulse.com.bd'
const ADMIN = 'https://admin.eventpulse.com.bd'
const DISALLOWED = 'https://evil.example.com'

const ORIGINAL = process.env['EVENTPULSE_CORS_ORIGINS']

describe('CORS preflight (browser-auth integration)', () => {
  beforeAll(() => {
    // Deterministic allowlist regardless of ambient env.
    process.env['EVENTPULSE_CORS_ORIGINS'] = [ALLOWED, ADMIN, 'https://my.eventpulse.com.bd'].join(
      ',',
    )
  })
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env['EVENTPULSE_CORS_ORIGINS']
    else process.env['EVENTPULSE_CORS_ORIGINS'] = ORIGINAL
  })

  it('echoes an allow-listed portal origin + allows credentials on OPTIONS preflight', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/tenant/me', {
      method: 'OPTIONS',
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'content-type',
      },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('does NOT echo a non-allow-listed origin (and never falls back to `*`)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/tenant/me', {
      method: 'OPTIONS',
      headers: {
        origin: DISALLOWED,
        'access-control-request-method': 'GET',
      },
    })
    expect(res.headers.get('access-control-allow-origin')).not.toBe(DISALLOWED)
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*')
  })

  it('adds the credentialed echo to an actual (non-preflight) response too', async () => {
    const app = createApp()
    const res = await app.request('/health', {
      method: 'GET',
      headers: { origin: ADMIN },
    })
    // Header is set by middleware regardless of the handler's status
    // (/health is 503 without a DB in the unit rig — irrelevant here).
    expect(res.headers.get('access-control-allow-origin')).toBe(ADMIN)
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
  })
})

describe('allowedOrigins() default (no EVENTPULSE_CORS_ORIGINS env)', () => {
  const ORIG = process.env['EVENTPULSE_CORS_ORIGINS']
  beforeAll(() => delete process.env['EVENTPULSE_CORS_ORIGINS'])
  afterAll(() => {
    if (ORIG === undefined) delete process.env['EVENTPULSE_CORS_ORIGINS']
    else process.env['EVENTPULSE_CORS_ORIGINS'] = ORIG
  })

  it('includes the apex + www (auth pages are served there) so login is not CORS-blocked', () => {
    const origins = allowedOrigins()
    expect(origins).toContain('https://eventpulse.com.bd')
    expect(origins).toContain('https://www.eventpulse.com.bd')
    expect(origins).toContain('https://app.eventpulse.com.bd')
  })
})

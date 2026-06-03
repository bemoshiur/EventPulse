/**
 * Session-cookie helper tests — browser-auth integration (Day 46, Option B).
 *
 * Pure (no DB): build a tiny Hono app, call the helper in a handler, inspect
 * the Set-Cookie header. The cookie carries the opaque session token; the API
 * middleware resolves it via resolveSession (live row). See
 * docs/design/browser-auth-integration.md §3.1 + §5 steps 2-4.
 */

import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'

import {
  clearSessionCookie,
  readSessionCookie,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from './cookie.js'

const ORIGINAL_DOMAIN = process.env['EVENTPULSE_COOKIE_DOMAIN']

describe('session cookie helpers', () => {
  afterEach(() => {
    if (ORIGINAL_DOMAIN === undefined) delete process.env['EVENTPULSE_COOKIE_DOMAIN']
    else process.env['EVENTPULSE_COOKIE_DOMAIN'] = ORIGINAL_DOMAIN
  })

  it('sets an HttpOnly, Secure, SameSite=Lax cookie carrying the token', async () => {
    const app = new Hono()
    app.get('/x', (c) => {
      setSessionCookie(c, 'tok-abc123', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
      return c.body('ok')
    })
    const res = await app.request('/x')
    const sc = res.headers.get('set-cookie') ?? ''
    expect(sc).toContain(`${SESSION_COOKIE_NAME}=tok-abc123`)
    expect(sc).toMatch(/HttpOnly/i)
    expect(sc).toMatch(/Secure/i)
    expect(sc).toMatch(/SameSite=Lax/i)
    expect(sc).toMatch(/Path=\//i)
  })

  it('applies Domain when EVENTPULSE_COOKIE_DOMAIN is set (cross-subdomain sharing)', async () => {
    process.env['EVENTPULSE_COOKIE_DOMAIN'] = 'eventpulse.com.bd'
    const app = new Hono()
    app.get('/x', (c) => {
      setSessionCookie(c, 'tok', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
      return c.body('ok')
    })
    const res = await app.request('/x')
    expect(res.headers.get('set-cookie') ?? '').toMatch(/Domain=eventpulse\.com\.bd/i)
  })

  it('clearSessionCookie expires the cookie', async () => {
    const app = new Hono()
    app.get('/x', (c) => {
      clearSessionCookie(c)
      return c.body('ok')
    })
    const res = await app.request('/x')
    const sc = res.headers.get('set-cookie') ?? ''
    expect(sc).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(sc).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i)
  })

  it('readSessionCookie reads the token back from the request', async () => {
    const app = new Hono()
    app.get('/x', (c) => c.json({ token: readSessionCookie(c) ?? null }))
    const res = await app.request('/x', { headers: { cookie: `${SESSION_COOKIE_NAME}=tok-xyz` } })
    const body = (await res.json()) as { token: string | null }
    expect(body.token).toBe('tok-xyz')
  })
})

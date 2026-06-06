/**
 * Auth routes set/clear the session cookie — browser-auth integration.
 * Password onboarding: signup does NOT open a session (email must be verified
 * first); verify-email/consume + login + reset open a session and emit the
 * HttpOnly `ep_session` cookie; logout clears it. DB-gated: CI only.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import { SESSION_COOKIE_NAME } from '../auth/cookie.js'
import { createApp } from '../app.js'
import { resetPool, withSuperAdmin } from '../db/client.js'
import { users } from '../db/schema/index.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('auth routes set/clear the session cookie (integration)', () => {
  const app = createApp()
  const stamp = Date.now()
  const email = `cookie-auth-${stamp}@test.local`
  const password = 'correcthorse123'
  let verifyToken = ''

  beforeAll(() => {
    process.env['JWT_ACCESS_SECRET'] = 'a'.repeat(64)
    process.env['JWT_REFRESH_SECRET'] = 'b'.repeat(64)
    process.env['MAIL_DRY_RUN'] = '1'
    process.env['AUTH_RETURN_MAGIC_LINK'] = '1'
  })
  afterAll(async () => {
    await withSuperAdmin(async (db) => {
      await db.delete(users).where(eq(users.email, email))
    })
    await resetPool()
  })

  it('password/signup does NOT open a session (no session cookie yet)', async () => {
    const res = await app.request('/api/v1/auth/password/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, fullName: 'Cookie Auth' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { _debug_token: string } }
    verifyToken = body.data._debug_token
    expect(verifyToken).toBeTruthy()
    const sc = res.headers.get('set-cookie') ?? ''
    expect(sc).not.toContain(`${SESSION_COOKIE_NAME}=`)
  })

  it('verify-email/consume sets an HttpOnly ep_session cookie', async () => {
    const res = await app.request('/api/v1/auth/verify-email/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: verifyToken }),
    })
    expect(res.status).toBe(200)
    const sc = res.headers.get('set-cookie') ?? ''
    expect(sc).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(sc).toMatch(/HttpOnly/i)
  })

  it('password/login (now verified) sets an HttpOnly ep_session cookie', async () => {
    const res = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }), // audience defaults to attendee
    })
    expect(res.status).toBe(200)
    const sc = res.headers.get('set-cookie') ?? ''
    expect(sc).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(sc).toMatch(/HttpOnly/i)
  })

  it('logout clears the cookie', async () => {
    const login = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const { data } = (await login.json()) as { data: { session: { token: string } } }
    const res = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: data.session.token }),
    })
    expect(res.status).toBe(200)
    const sc = res.headers.get('set-cookie') ?? ''
    expect(sc).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(sc).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i)
  })
})

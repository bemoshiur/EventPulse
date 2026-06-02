/**
 * Integration tests for /api/v1/auth/* routes.
 *
 * Requires a real DATABASE_URL (CI integration-tests job provides it).
 * Skipped automatically without one.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../app.js'
import { resetPool, withSuperAdmin } from '../db/client.js'
import { superAdmins, tenantUsers, tenants, users } from '../db/schema/index.js'
import { eq, inArray } from 'drizzle-orm'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('auth routes (integration)', () => {
  const app = createApp()
  const cleanup: string[] = []
  const userIdCleanup: string[] = []
  const tenantIdCleanup: string[] = []
  const stamp = Date.now()

  // Signup helper: returns the created user's id + records it for cleanup.
  async function signup(email: string, fullName = 'Grant Test'): Promise<string> {
    cleanup.push(email)
    const res = await app.request('/api/v1/auth/password/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correcthorse123', fullName }),
    })
    const body = (await res.json()) as { data: { user: { id: string } } }
    userIdCleanup.push(body.data.user.id)
    return body.data.user.id
  }

  beforeAll(() => {
    process.env['JWT_ACCESS_SECRET'] = 'a'.repeat(64)
    process.env['JWT_REFRESH_SECRET'] = 'b'.repeat(64)
    process.env['AUTH_RETURN_MAGIC_LINK'] = '1'
    process.env['MAIL_DRY_RUN'] = '1'
  })

  afterAll(async () => {
    await withSuperAdmin(async (db) => {
      // FK order: tenant_users + super_admins reference users; tenants is referenced
      // by tenant_users. Delete children before parents.
      if (userIdCleanup.length > 0) {
        await db.delete(tenantUsers).where(inArray(tenantUsers.userId, userIdCleanup))
        await db.delete(superAdmins).where(inArray(superAdmins.userId, userIdCleanup))
      }
      if (tenantIdCleanup.length > 0) {
        await db.delete(tenants).where(inArray(tenants.id, tenantIdCleanup))
      }
      for (const email of cleanup) {
        await db.delete(users).where(eq(users.email, email))
      }
    })
    await resetPool()
  })

  it('POST /password/signup creates a user + session + tokens', async () => {
    const email = `signup-${stamp}@test.local`
    cleanup.push(email)
    const res = await app.request('/api/v1/auth/password/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correcthorse123', fullName: 'Sign Up' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data: { user: { id: string; email: string }; session: { token: string; accessToken: string } }
    }
    expect(body.data.user.email).toBe(email)
    expect(body.data.session.token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(body.data.session.accessToken.split('.').length).toBe(3)
  })

  it('signup with same email returns 409', async () => {
    const email = `dupe-${stamp}@test.local`
    cleanup.push(email)
    await app.request('/api/v1/auth/password/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correcthorse123', fullName: 'First' }),
    })
    const second = await app.request('/api/v1/auth/password/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correcthorse123', fullName: 'Second' }),
    })
    expect(second.status).toBe(409)
  })

  it('login with wrong password returns 401', async () => {
    const email = `wrongpw-${stamp}@test.local`
    cleanup.push(email)
    await app.request('/api/v1/auth/password/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correcthorse123', fullName: 'Wrong' }),
    })
    const res = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrongpassword' }),
    })
    expect(res.status).toBe(401)
  })

  it('login for nonexistent email also returns 401 (no enumeration leak)', async () => {
    const res = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `nobody-${stamp}@test.local`, password: 'whatever123' }),
    })
    expect(res.status).toBe(401)
  })

  it('magic-link signup flow: request, then consume creates the user', async () => {
    const email = `magic-${stamp}@test.local`
    cleanup.push(email)

    const reqRes = await app.request('/api/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, purpose: 'signup' }),
    })
    expect(reqRes.status).toBe(202)
    const reqBody = (await reqRes.json()) as {
      data: { _debug_token: string }
    }
    expect(reqBody.data._debug_token).toBeTruthy()

    const consumeRes = await app.request('/api/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: reqBody.data._debug_token,
        audience: 'attendee',
        fullName: 'Magic Link',
      }),
    })
    expect(consumeRes.status).toBe(200)
    const consumeBody = (await consumeRes.json()) as {
      data: { user: { email: string }; session: { token: string } }
    }
    expect(consumeBody.data.user.email).toBe(email)
    expect(consumeBody.data.session.token).toBeTruthy()
  })

  it('magic-link token is single-use', async () => {
    const email = `single-use-${stamp}@test.local`
    cleanup.push(email)
    // create user first
    const signup = await app.request('/api/v1/auth/password/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correcthorse123', fullName: 'Single Use' }),
    })
    expect(signup.status).toBe(201)
    const reqRes = await app.request('/api/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, purpose: 'signin' }),
    })
    const reqBody = (await reqRes.json()) as { data: { _debug_token: string } }
    const token = reqBody.data._debug_token

    const first = await app.request('/api/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, audience: 'attendee' }),
    })
    expect(first.status).toBe(200)

    const second = await app.request('/api/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, audience: 'attendee' }),
    })
    expect(second.status).toBe(401)
  })

  it('logout revokes the session', async () => {
    const email = `logout-${stamp}@test.local`
    cleanup.push(email)
    const signupRes = await app.request('/api/v1/auth/password/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correcthorse123', fullName: 'Out' }),
    })
    const { data } = (await signupRes.json()) as { data: { session: { token: string } } }
    const logoutRes = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: data.session.token }),
    })
    expect(logoutRes.status).toBe(200)
  })

  // ─── audience-grant enforcement (Day-45 critical auth fix) ──────────────
  // Login/consume must NOT trust a client-supplied audience: super-admin
  // requires a super_admins row; tenant requires a tenant_users row for that
  // tenantId. Negatives below fail (return 200) against the pre-fix code.

  it('login with audience=super-admin for a NON-super-admin user → 403', async () => {
    const email = `grant-sa-neg-${stamp}@test.local`
    await signup(email)
    const res = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correcthorse123', audience: 'super-admin' }),
    })
    expect(res.status).toBe(403)
  })

  it('login with audience=super-admin for a super_admins member → 200', async () => {
    const email = `grant-sa-pos-${stamp}@test.local`
    const userId = await signup(email)
    await withSuperAdmin(async (db) => {
      await db.insert(superAdmins).values({ userId })
    })
    const res = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correcthorse123', audience: 'super-admin' }),
    })
    expect(res.status).toBe(200)
  })

  it('login with audience=tenant for a tenant the user is NOT a member of → 403', async () => {
    const email = `grant-tn-neg-${stamp}@test.local`
    await signup(email)
    const res = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'correcthorse123',
        audience: 'tenant',
        tenantId: '99999999-9999-9999-9999-999999999999',
      }),
    })
    expect(res.status).toBe(403)
  })

  it('login with audience=tenant for a tenant the user IS a member of → 200', async () => {
    const email = `grant-tn-pos-${stamp}@test.local`
    const userId = await signup(email)
    const tenantId = await withSuperAdmin(async (db) => {
      const [t] = await db
        .insert(tenants)
        .values({ name: 'Grant Test Tenant', slug: `agtest-${stamp}` })
        .returning({ id: tenants.id })
      await db.insert(tenantUsers).values({ tenantId: t!.id, userId, role: 'owner' })
      return t!.id
    })
    tenantIdCleanup.push(tenantId)
    const res = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correcthorse123', audience: 'tenant', tenantId }),
    })
    expect(res.status).toBe(200)
  })

  it('magic-link consume with audience=super-admin for a NON-super-admin → 403', async () => {
    const email = `grant-magic-${stamp}@test.local`
    await signup(email)
    const reqRes = await app.request('/api/v1/auth/magic-link/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, purpose: 'signin' }),
    })
    const reqBody = (await reqRes.json()) as { data: { _debug_token: string } }
    const res = await app.request('/api/v1/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: reqBody.data._debug_token, audience: 'super-admin' }),
    })
    expect(res.status).toBe(403)
  })
})

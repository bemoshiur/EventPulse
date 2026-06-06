/**
 * Integration tests for /api/v1/auth/* routes (password onboarding).
 *
 * Requires a real DATABASE_URL (CI integration-tests job provides it).
 * Skipped automatically without one. AUTH_RETURN_MAGIC_LINK=1 surfaces the
 * email-verify / password-reset tokens inline so the flow is testable without
 * a mailbox.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../app.js'
import { resetPool, withSuperAdmin } from '../db/client.js'
import { superAdmins, tenantUsers, tenants, users } from '../db/schema/index.js'
import { eq, inArray } from 'drizzle-orm'
import { generateTotp } from '../auth/totp.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

const JSON_HEADERS = { 'content-type': 'application/json' }

describeIfDb('auth routes (integration)', () => {
  const app = createApp()
  const cleanup: string[] = []
  const userIdCleanup: string[] = []
  const tenantIdCleanup: string[] = []
  const stamp = Date.now()

  const PW = 'correcthorse123'

  // Raw signup — creates an UNVERIFIED user; returns id + the inline verify token.
  async function signupRaw(
    email: string,
    fullName = 'Grant Test',
  ): Promise<{ userId: string; token: string }> {
    cleanup.push(email)
    const res = await app.request('/api/v1/auth/password/signup', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password: PW, fullName }),
    })
    const body = (await res.json()) as { data: { user: { id: string }; _debug_token: string } }
    userIdCleanup.push(body.data.user.id)
    return { userId: body.data.user.id, token: body.data._debug_token }
  }

  // Verified signup — signs up + confirms the email; returns the user id.
  async function signup(email: string, fullName = 'Grant Test'): Promise<string> {
    const { userId, token } = await signupRaw(email, fullName)
    const res = await app.request('/api/v1/auth/verify-email/consume', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token }),
    })
    expect(res.status).toBe(200)
    return userId
  }

  beforeAll(() => {
    process.env['JWT_ACCESS_SECRET'] = 'a'.repeat(64)
    process.env['JWT_REFRESH_SECRET'] = 'b'.repeat(64)
    process.env['AUTH_RETURN_MAGIC_LINK'] = '1'
    process.env['MAIL_DRY_RUN'] = '1'
  })

  afterAll(async () => {
    await withSuperAdmin(async (db) => {
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

  it('POST /password/signup creates an UNVERIFIED user + sends verification (no session)', async () => {
    const email = `signup-${stamp}@test.local`
    cleanup.push(email)
    const res = await app.request('/api/v1/auth/password/signup', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password: PW, fullName: 'Sign Up' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data: {
        user: { id: string; email: string }
        emailVerificationRequired: boolean
        session?: unknown
        _debug_token: string
      }
    }
    userIdCleanup.push(body.data.user.id)
    expect(body.data.user.email).toBe(email)
    expect(body.data.emailVerificationRequired).toBe(true)
    expect(body.data.session).toBeUndefined()
    expect(body.data._debug_token).toBeTruthy()
  })

  it('signup with same email returns 409', async () => {
    const email = `dupe-${stamp}@test.local`
    await signupRaw(email, 'First')
    const second = await app.request('/api/v1/auth/password/signup', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password: PW, fullName: 'Second' }),
    })
    expect(second.status).toBe(409)
  })

  it('login BEFORE verifying email → 403 EMAIL_NOT_VERIFIED', async () => {
    const email = `unverified-${stamp}@test.local`
    await signupRaw(email)
    const res = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password: PW }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('EMAIL_NOT_VERIFIED')
  })

  it('verify-email/consume confirms the address + opens a session', async () => {
    const email = `verify-${stamp}@test.local`
    const { token } = await signupRaw(email)
    const res = await app.request('/api/v1/auth/verify-email/consume', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { session: { token: string; accessToken: string } } }
    expect(body.data.session.token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(body.data.session.accessToken.split('.').length).toBe(3)
  })

  it('verify-email token is single-use', async () => {
    const email = `verify-single-${stamp}@test.local`
    const { token } = await signupRaw(email)
    const first = await app.request('/api/v1/auth/verify-email/consume', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token }),
    })
    expect(first.status).toBe(200)
    const second = await app.request('/api/v1/auth/verify-email/consume', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token }),
    })
    expect(second.status).toBe(401)
  })

  it('login AFTER verifying → 200', async () => {
    const email = `verified-login-${stamp}@test.local`
    await signup(email)
    const res = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password: PW }),
    })
    expect(res.status).toBe(200)
  })

  it('login with wrong password returns 401 (checked before the verify gate)', async () => {
    const email = `wrongpw-${stamp}@test.local`
    await signupRaw(email)
    const res = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password: 'wrongpassword' }),
    })
    expect(res.status).toBe(401)
  })

  it('login for nonexistent email also returns 401 (no enumeration leak)', async () => {
    const res = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: `nobody-${stamp}@test.local`, password: 'whatever123' }),
    })
    expect(res.status).toBe(401)
  })

  it('forgot → reset → login with the NEW password', async () => {
    const email = `reset-${stamp}@test.local`
    await signup(email)
    const forgot = await app.request('/api/v1/auth/password/forgot', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email }),
    })
    expect(forgot.status).toBe(202)
    const forgotBody = (await forgot.json()) as { data: { _debug_token: string } }
    const reset = await app.request('/api/v1/auth/password/reset', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: forgotBody.data._debug_token, password: 'brandnewpass456' }),
    })
    expect(reset.status).toBe(200)
    // Old password no longer works.
    const oldPw = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password: PW }),
    })
    expect(oldPw.status).toBe(401)
    // New password works.
    const newPw = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password: 'brandnewpass456' }),
    })
    expect(newPw.status).toBe(200)
  })

  it('forgot for a nonexistent email still returns 202 (no enumeration)', async () => {
    const res = await app.request('/api/v1/auth/password/forgot', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: `ghost-${stamp}@test.local` }),
    })
    expect(res.status).toBe(202)
  })

  it('logout revokes the session', async () => {
    const email = `logout-${stamp}@test.local`
    const { token } = await signupRaw(email, 'Out')
    const verifyRes = await app.request('/api/v1/auth/verify-email/consume', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token }),
    })
    const { data } = (await verifyRes.json()) as { data: { session: { token: string } } }
    const logoutRes = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: data.session.token }),
    })
    expect(logoutRes.status).toBe(200)
  })

  // ─── audience-grant enforcement (Day-45 critical auth fix) ──────────────
  // Login must NOT trust a client-supplied audience: super-admin requires a
  // super_admins row; tenant requires a tenant_users row for that tenantId.
  // (Users are verified by the signup() helper so login reaches the grant check.)

  it('login with audience=super-admin for a NON-super-admin user → 403', async () => {
    const email = `grant-sa-neg-${stamp}@test.local`
    await signup(email)
    const res = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password: PW, audience: 'super-admin' }),
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
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password: PW, audience: 'super-admin' }),
    })
    expect(res.status).toBe(200)
  })

  it('login with audience=tenant for a tenant the user is NOT a member of → 403', async () => {
    const email = `grant-tn-neg-${stamp}@test.local`
    await signup(email)
    const res = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        email,
        password: PW,
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
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password: PW, audience: 'tenant', tenantId }),
    })
    expect(res.status).toBe(200)
  })

  // ─── MFA / TOTP login gate ──────────────────────────────────────────────
  it('MFA: enroll → confirm → login is gated → /mfa/verify with a TOTP issues a session; recovery code also works', async () => {
    const email = `mfa-${stamp}@test.local`
    const { token } = await signupRaw(email, 'MFA User')
    const verifyRes = await app.request('/api/v1/auth/verify-email/consume', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token }),
    })
    const accessToken = ((await verifyRes.json()) as { data: { session: { accessToken: string } } })
      .data.session.accessToken
    const authed = { ...JSON_HEADERS, authorization: `Bearer ${accessToken}` }

    // enroll → secret
    const enroll = await app.request('/api/v1/auth/mfa/enroll', { method: 'POST', headers: authed })
    expect(enroll.status).toBe(200)
    const { secret } = ((await enroll.json()) as { data: { secret: string } }).data

    // confirm with a live code → enabled + recovery codes
    const confirm = await app.request('/api/v1/auth/mfa/confirm', {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ code: generateTotp(secret) }),
    })
    expect(confirm.status).toBe(200)
    const recovery = ((await confirm.json()) as { data: { recoveryCodes: string[] } }).data
      .recoveryCodes
    expect(recovery.length).toBeGreaterThan(0)

    // login now returns a challenge, NOT a session
    const login = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password: PW }),
    })
    expect(login.status).toBe(200)
    const loginBody = (await login.json()) as {
      data: { mfaRequired?: boolean; challengeToken?: string; session?: unknown }
    }
    expect(loginBody.data.mfaRequired).toBe(true)
    expect(loginBody.data.session).toBeUndefined()

    // wrong code → 401
    const bad = await app.request('/api/v1/auth/mfa/verify', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ challengeToken: loginBody.data.challengeToken, code: '000000' }),
    })
    expect(bad.status).toBe(401)

    // correct TOTP → session
    const verify = await app.request('/api/v1/auth/mfa/verify', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        challengeToken: loginBody.data.challengeToken,
        code: generateTotp(secret),
      }),
    })
    expect(verify.status).toBe(200)
    expect(
      ((await verify.json()) as { data: { session: { token: string } } }).data.session.token,
    ).toBeTruthy()

    // a recovery code works as a second factor on a fresh challenge
    const login2 = await app.request('/api/v1/auth/password/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password: PW }),
    })
    const challenge2 = ((await login2.json()) as { data: { challengeToken: string } }).data
      .challengeToken
    const rec = await app.request('/api/v1/auth/mfa/verify', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ challengeToken: challenge2, code: recovery[0] }),
    })
    expect(rec.status).toBe(200)
  })
})

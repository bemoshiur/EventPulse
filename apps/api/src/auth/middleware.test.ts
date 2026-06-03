/**
 * Auth-middleware session-cookie tests — browser-auth integration (Day 46, Option B, step 2).
 *
 * The browser sends the opaque session token in an HttpOnly cookie (no Bearer
 * header). The middleware must read the cookie, resolve it via `resolveSession`
 * (live `sessions` row — revoked/expired → 401), and populate the same claims
 * the Bearer path does. DB-gated: runs in CI (postgres:16), skips locally.
 */

import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import { resetPool, withSuperAdmin } from '../db/client.js'
import { tenants, users } from '../db/schema/index.js'
import { SESSION_COOKIE_NAME } from './cookie.js'
import { requireTenantAuth } from './middleware.js'
import { createSession, revokeSession } from './sessions.js'
import { createUser } from './users.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('auth middleware — session cookie (integration)', () => {
  const stamp = Date.now()
  let userId = ''
  let tenantId = ''
  let token = ''

  // Tiny app gated by requireTenantAuth; echoes the resolved context.
  const app = new Hono()
  app.get('/probe', requireTenantAuth, (c) =>
    c.json({ tenantId: c.get('tenantId'), sub: c.get('auth')?.sub }),
  )

  beforeAll(async () => {
    const user = await createUser({ email: `mw-cookie-${stamp}@test.local`, fullName: 'MW Cookie' })
    userId = user.id
    tenantId = await withSuperAdmin(async (db) => {
      const [t] = await db
        .insert(tenants)
        .values({ name: 'MW Cookie Tenant', slug: `mwcookie-${stamp}` })
        .returning({ id: tenants.id })
      return t!.id
    })
    const created = await createSession({ userId, audience: 'tenant', tenantId })
    token = created.token
  })

  afterAll(async () => {
    await revokeSession(token).catch(() => undefined)
    await withSuperAdmin(async (db) => {
      await db.delete(tenants).where(eq(tenants.id, tenantId))
      await db.delete(users).where(eq(users.id, userId))
    })
    await resetPool()
  })

  it('a valid session cookie (no Bearer) authenticates the tenant route', async () => {
    const res = await app.request('/probe', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tenantId: string; sub: string }
    expect(body.tenantId).toBe(tenantId)
    expect(body.sub).toBe(userId)
  })

  it('no credential at all → 401', async () => {
    const res = await app.request('/probe')
    expect(res.status).toBe(401)
  })

  it('a bogus cookie → 401', async () => {
    const res = await app.request('/probe', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-real-token` },
    })
    expect(res.status).toBe(401)
  })

  it('a revoked session cookie → 401 (live-row check, the Bearer path lacks)', async () => {
    const ephemeral = await createSession({ userId, audience: 'tenant', tenantId })
    await revokeSession(ephemeral.token)
    const res = await app.request('/probe', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${ephemeral.token}` },
    })
    expect(res.status).toBe(401)
  })
})

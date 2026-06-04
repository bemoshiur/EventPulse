/**
 * Self-service hosting routes — mounted at `/api/v1/my/hosting` (§10.3).
 *
 *   POST /api/v1/my/hosting/start — start hosting: provision the caller's
 *     personal tenant (idempotent) and enter its tenant context (mint a
 *     tenant-scoped session). The web app then lands the user on the
 *     event-create page in that context.
 *
 * Any authenticated user may call it (requireUser) — a freshly-signed-in user
 * holds an attendee session and has no tenant yet; this is how they get one.
 */

import { Hono } from 'hono'

import { setSessionCookie } from '../../auth/cookie.js'
import { signTokens } from '../../auth/jwt.js'
import { requireUser } from '../../auth/middleware.js'
import { createSession } from '../../auth/sessions.js'
import { hashToken } from '../../auth/tokens.js'
import { ensurePersonalTenant } from '../../services/hosting/index.js'

const hosting = new Hono()

hosting.use('*', requireUser)

hosting.post('/start', async (c) => {
  const userId = c.get('auth')!.sub
  const tenant = await ensurePersonalTenant(userId)

  const { token, expiresAt } = await createSession({
    userId,
    audience: 'tenant',
    tenantId: tenant.id,
    ip: c.req.header('x-forwarded-for') ?? null,
    userAgent: c.req.header('user-agent') ?? null,
  })
  setSessionCookie(c, token, expiresAt)
  const tokens = await signTokens({
    sub: userId,
    audience: 'tenant',
    tenantId: tenant.id,
    sessionId: hashToken(token),
  })

  return c.json({
    data: {
      tenantId: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      session: { token, ...tokens },
    },
  })
})

export { hosting as myHostingRoutes }

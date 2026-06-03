/**
 * Tenant-context picker routes — mounted at `/api/v1/my/contexts` (§10.3).
 *
 *   GET  /api/v1/my/contexts          — list the tenants the user may act in
 *   POST /api/v1/my/contexts/switch   — enter a tenant context (mint a
 *                                        tenant-scoped session for it)
 *
 * These power the post-login tenant picker (decisions.md 2026-06-04 "always
 * show a picker"). A user who just consumed a magic link at
 * `app.eventpulse.com.bd` holds an `attendee` session; the picker lists their
 * tenants and the switch route upgrades them into a `tenant` session.
 *
 * **Authority model (Day-45 fix, reused):** the switch route NEVER trusts the
 * body's `tenantId` as proof of access — it re-runs `decideAudience('tenant',
 * grants, tenantId)` against the user's live `tenant_users` membership before
 * minting anything. RLS still scopes every downstream `/tenant/*` request by
 * the session's tenantId regardless.
 */

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { decideAudience, fetchAudienceGrants } from '../../auth/audience-grant.js'
import { setSessionCookie } from '../../auth/cookie.js'
import { signTokens } from '../../auth/jwt.js'
import { requireUser } from '../../auth/middleware.js'
import { createSession } from '../../auth/sessions.js'
import { hashToken } from '../../auth/tokens.js'
import { listUserContexts } from '../../services/contexts/index.js'

const contexts = new Hono()

contexts.use('*', requireUser)

contexts.get('/', async (c) => {
  const userId = c.get('auth')!.sub
  const list = await listUserContexts(userId)
  return c.json({ data: { contexts: list } })
})

const switchSchema = z.object({ tenantId: z.string().uuid() })

contexts.post('/switch', zValidator('json', switchSchema), async (c) => {
  const userId = c.get('auth')!.sub
  const { tenantId } = c.req.valid('json')

  // Authority: the body's tenantId is a request, not proof. Re-check membership.
  const grant = decideAudience('tenant', await fetchAudienceGrants(userId), tenantId)
  if (!grant.allowed) {
    return c.json(
      { error: { code: 'FORBIDDEN', message: grant.reason ?? 'not a member of this tenant' } },
      403,
    )
  }

  const { token, expiresAt } = await createSession({
    userId,
    audience: 'tenant',
    tenantId,
    ip: c.req.header('x-forwarded-for') ?? null,
    userAgent: c.req.header('user-agent') ?? null,
  })
  setSessionCookie(c, token, expiresAt)
  const tokens = await signTokens({
    sub: userId,
    audience: 'tenant',
    tenantId,
    sessionId: hashToken(token),
  })

  return c.json({ data: { tenantId, session: { token, ...tokens } } })
})

export { contexts as myContextsRoutes }

/**
 * Auth routes for Sprint 1 Day 7-8. Mounted at /api/v1/auth.
 *
 * Surface (today):
 *   POST /password/signup         — email+password registration (no KYC)
 *   POST /password/login          — email+password login
 *   POST /magic-link/request      — email a one-time sign-in token
 *   POST /magic-link/consume      — exchange token for session + JWTs
 *   POST /logout                  — revoke the session bound to the request
 *
 * OAuth (Google + Apple) routes are wired in `oauth-routes.ts` and
 * folded into this router when the OAuth env is present.
 *
 * NOTE: Email delivery is stubbed — `requestMagicLink` returns the token
 * inline in the response when `process.env.AUTH_RETURN_MAGIC_LINK === '1'`
 * (dev / test only). Day 9-10 wires SES.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { decideAudience, fetchAudienceGrants } from '../auth/audience-grant.js'
import { buildConsumeUrl, resolveConsumeBase } from '../auth/consume-url.js'
import { clearSessionCookie, setSessionCookie } from '../auth/cookie.js'
import { hashPassword, verifyPassword } from '../auth/hash.js'
import { allowedOrigins } from '../middleware/cors.js'
import { signTokens } from '../auth/jwt.js'
import { consumeMagicLink, requestMagicLink, type MagicLinkPurpose } from '../auth/magic-link.js'
import { requireUser } from '../auth/middleware.js'
import { createSession, revokeSession, type SessionAudience } from '../auth/sessions.js'
import { hashToken } from '../auth/tokens.js'
import { createUser, findUserByEmail, markEmailVerified } from '../auth/users.js'
import { sendEmail } from '../infra/ses/client.js'
import { renderMagicLink } from '../infra/ses/templates/magic-link.js'
import { logger } from '../lib/logger.js'

const auth = new Hono()

const audienceSchema = z.enum(['super-admin', 'tenant', 'attendee'])

const signupSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8).max(200),
  fullName: z.string().min(2).max(120),
})

auth.post('/password/signup', zValidator('json', signupSchema), async (c) => {
  const input = c.req.valid('json')
  const existing = await findUserByEmail(input.email)
  if (existing) {
    return c.json(
      {
        error: {
          code: 'CONFLICT',
          message: 'email already registered',
        },
      },
      409,
    )
  }
  const hash = await hashPassword(input.password)
  const user = await createUser({
    email: input.email,
    fullName: input.fullName,
    passwordHash: hash,
  })
  // New attendee account by default; tenant/super-admin require explicit grant.
  const { token, expiresAt } = await createSession({
    userId: user.id,
    audience: 'attendee',
    ip: c.req.header('x-forwarded-for') ?? null,
    userAgent: c.req.header('user-agent') ?? null,
  })
  setSessionCookie(c, token, expiresAt)
  const tokens = await signTokens({
    sub: user.id,
    audience: 'attendee',
    tenantId: null,
    sessionId: hashToken(token),
  })
  return c.json(
    {
      data: {
        user: { id: user.id, email: user.email, fullName: user.fullName },
        session: { token, ...tokens },
      },
    },
    201,
  )
})

const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1).max(200),
  audience: audienceSchema.default('attendee'),
  tenantId: z.string().uuid().optional(),
})

auth.post('/password/login', zValidator('json', loginSchema), async (c) => {
  const input = c.req.valid('json')
  const user = await findUserByEmail(input.email)
  // Constant-ish-time: always run hash compare even if the user doesn't exist,
  // to avoid timing-leak that reveals account existence.
  const hash = user?.passwordHash ?? '$argon2id$v=19$m=65536,t=3,p=4$ZHVtbXlzYWx0$ZHVtbXloYXNo'
  const ok = await verifyPassword(input.password, hash)
  if (!user || !user.passwordHash || !ok) {
    return c.json({ error: { code: 'AUTH_REQUIRED', message: 'invalid credentials' } }, 401)
  }
  const audience = input.audience as SessionAudience['audience']
  if (audience === 'tenant' && !input.tenantId) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'tenantId required for tenant audience' } },
      400,
    )
  }
  // Audience-grant authority: never trust the client's requested audience.
  // super-admin requires a super_admins row; tenant requires tenant_users
  // membership for the requested tenantId (Day-45 critical auth fix).
  const grant = decideAudience(audience, await fetchAudienceGrants(user.id), input.tenantId)
  if (!grant.allowed) {
    return c.json(
      { error: { code: 'FORBIDDEN', message: grant.reason ?? 'audience not granted' } },
      403,
    )
  }
  const { token, expiresAt } = await createSession({
    userId: user.id,
    audience,
    tenantId: audience === 'tenant' ? input.tenantId! : undefined,
    ip: c.req.header('x-forwarded-for') ?? null,
    userAgent: c.req.header('user-agent') ?? null,
  })
  setSessionCookie(c, token, expiresAt)
  const tokens = await signTokens({
    sub: user.id,
    audience,
    tenantId: audience === 'tenant' ? input.tenantId! : null,
    sessionId: hashToken(token),
  })
  return c.json({
    data: {
      user: { id: user.id, email: user.email, fullName: user.fullName },
      session: { token, ...tokens },
    },
  })
})

const magicRequestSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  purpose: z.enum(['signup', 'signin']).default('signin'),
  // Which portal the link logs into. Travels in the link; the #267 grant check
  // at consume is the authority (requesting super-admin without the role → 403).
  // `tenant` is omitted here — a tenant session needs a tenantId the magic-link
  // flow doesn't carry; tenant context is entered via the context switcher.
  audience: z.enum(['super-admin', 'attendee']).default('attendee'),
})

auth.post('/magic-link/request', zValidator('json', magicRequestSchema), async (c) => {
  const input = c.req.valid('json')
  const user = await findUserByEmail(input.email)
  // Always respond 202 to avoid enumeration. Generate a token regardless.
  const { token, expiresAt } = await requestMagicLink({
    email: input.email,
    purpose: input.purpose as MagicLinkPurpose,
    userId: user?.id ?? null,
    ip: c.req.header('x-forwarded-for') ?? null,
  })

  // Land the link on the portal the user signed in from (request Origin, if
  // allow-listed), else the per-env default. NEVER the old staging fallback.
  const fallbackBase = process.env['EVENTPULSE_BASE_URL'] ?? 'https://app.eventpulse.com.bd'
  const base = resolveConsumeBase(c.req.header('origin'), allowedOrigins(), fallbackBase)
  const url = buildConsumeUrl({ base, token, purpose: input.purpose, audience: input.audience })

  const rendered = renderMagicLink({
    url,
    expiresAt,
    purpose: input.purpose as 'signin' | 'signup',
  })
  try {
    await sendEmail({
      to: input.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { template_id: rendered.templateId, purpose: input.purpose },
    })
  } catch (err) {
    logger.error({ err, email_sha: hashToken(input.email).slice(0, 16) }, 'magic_link.send_failed')
    // Still return 202 so we don't reveal account state on transient SES errors.
  }

  const debugInline = process.env['AUTH_RETURN_MAGIC_LINK'] === '1'
  return c.json(
    {
      data: {
        delivered: true,
        expiresAt: expiresAt.toISOString(),
        ...(debugInline ? { _debug_token: token, _debug_url: url } : {}),
      },
    },
    202,
  )
})

const magicConsumeSchema = z.object({
  token: z.string().min(20),
  audience: audienceSchema.default('attendee'),
  tenantId: z.string().uuid().optional(),
  fullName: z.string().min(2).max(120).optional(), // for signup path
})

auth.post('/magic-link/consume', zValidator('json', magicConsumeSchema), async (c) => {
  const input = c.req.valid('json')
  const ip = c.req.header('x-forwarded-for') ?? null
  const result = await consumeMagicLink(input.token, ip)
  if (!result) {
    return c.json({ error: { code: 'AUTH_REQUIRED', message: 'invalid or expired link' } }, 401)
  }

  let user = await findUserByEmail(result.email)
  if (!user) {
    if (result.purpose !== 'signup') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'no account for this email' } }, 404)
    }
    if (!input.fullName) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'fullName required for signup' } },
        400,
      )
    }
    user = await createUser({ email: result.email, fullName: input.fullName })
  }
  await markEmailVerified(user.id)

  const audience = input.audience as SessionAudience['audience']
  // Audience-grant authority (Day-45 critical auth fix): same enforcement as
  // /password/login — the magic-link path must not trust the client audience.
  const grant = decideAudience(audience, await fetchAudienceGrants(user.id), input.tenantId)
  if (!grant.allowed) {
    return c.json(
      { error: { code: 'FORBIDDEN', message: grant.reason ?? 'audience not granted' } },
      403,
    )
  }
  const { token, expiresAt } = await createSession({
    userId: user.id,
    audience,
    tenantId: audience === 'tenant' ? input.tenantId : undefined,
    ip,
    userAgent: c.req.header('user-agent') ?? null,
  })
  setSessionCookie(c, token, expiresAt)
  const tokens = await signTokens({
    sub: user.id,
    audience,
    tenantId: audience === 'tenant' ? (input.tenantId ?? null) : null,
    sessionId: hashToken(token),
  })

  return c.json({
    data: {
      user: { id: user.id, email: user.email, fullName: user.fullName },
      session: { token, ...tokens },
    },
  })
})

/**
 * GET /session — "who am I" for the web layout auth-gate. Any authenticated
 * audience may call it (requireUser); it echoes the session's audience +
 * tenantId so the gate can match the route group. No body, no DB beyond the
 * middleware's session resolution.
 */
auth.get('/session', requireUser, (c) => {
  const claims = c.get('auth')!
  return c.json({
    data: { userId: claims.sub, audience: claims.audience, tenantId: claims.tenantId ?? null },
  })
})

const logoutSchema = z.object({
  token: z.string().min(20),
})

auth.post('/logout', zValidator('json', logoutSchema), async (c) => {
  await revokeSession(c.req.valid('json').token)
  clearSessionCookie(c)
  return c.json({ data: { revoked: true } })
})

export { auth as authRoutes }

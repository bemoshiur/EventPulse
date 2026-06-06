/**
 * Auth routes for Sprint 1 Day 7-8. Mounted at /api/v1/auth.
 *
 * Surface:
 *   POST /password/signup          — email+password registration → sends verify email (no session)
 *   POST /password/login           — email+password login (blocked until email verified)
 *   POST /verify-email/request     — (re)send the confirmation email
 *   POST /verify-email/consume     — confirm address from the link → session
 *   POST /password/forgot          — email a reset link
 *   POST /password/reset           — set a new password from the link → session
 *   GET  /session                  — current session identity (layout auth-gate)
 *   POST /logout                   — revoke the session bound to the request
 *
 * Onboarding is password-only with email verification (decisions.md 2026-06-06
 * "Onboarding → password-only + email verification; magic-link LOGIN removed").
 * The magic_links table remains the single-use TTL'd token store backing
 * 'email_verify' + 'password_reset'; there is no magic-link LOGIN path.
 * Third-party (Google/OAuth) sign-in was removed 2026-06-04. The
 * oauth_identities table + helpers remain for historical rows only.
 */

import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { decideAudience, fetchAudienceGrants } from '../auth/audience-grant.js'
import { resolveConsumeBase } from '../auth/consume-url.js'
import { clearSessionCookie, setSessionCookie } from '../auth/cookie.js'
import { hashPassword, verifyPassword } from '../auth/hash.js'
import { allowedOrigins } from '../middleware/cors.js'
import { signMfaChallenge, signTokens, verifyMfaChallenge } from '../auth/jwt.js'
import { consumeMagicLink, requestMagicLink } from '../auth/magic-link.js'
import { requireUser } from '../auth/middleware.js'
import {
  createSession,
  revokeAllUserSessions,
  revokeSession,
  type SessionAudience,
} from '../auth/sessions.js'
import { hashToken } from '../auth/tokens.js'
import {
  consumeRecoveryCode,
  createUser,
  disableMfa,
  enableMfa,
  findUserByEmail,
  findUserById,
  getMfaState,
  markEmailVerified,
  setMfaSecret,
  setPassword,
} from '../auth/users.js'
import {
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from '../auth/totp.js'
import QRCode from 'qrcode'
import { sendEmail } from '../infra/ses/client.js'
import { renderResetPassword } from '../infra/ses/templates/reset-password.js'
import { renderVerifyEmail } from '../infra/ses/templates/verify-email.js'
import { logger } from '../lib/logger.js'

/**
 * Resolve the web base URL a verification / reset link should land on. Prefers
 * the request Origin (if allow-listed) so the link returns the user to the
 * portal they started from; else the per-env web base.
 */
function webBase(originHeader: string | undefined): string {
  const fallback = process.env['EVENTPULSE_WEB_BASE_URL'] ?? 'https://eventpulse.com.bd'
  return resolveConsumeBase(originHeader, allowedOrigins(), fallback)
}

const auth = new Hono()

const audienceSchema = z.enum(['super-admin', 'tenant', 'attendee'])

const signupSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8).max(200),
  fullName: z.string().min(2).max(120),
})

/**
 * Issue an email_verify token + send the confirmation email. Shared by signup
 * and the resend endpoint. Returns expiresAt; never throws on SES failure (we
 * don't want signup to 500 on a transient send error — the user can resend).
 */
async function sendVerificationEmail(
  c: Context,
  email: string,
  userId: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const { token, expiresAt } = await requestMagicLink({
    email,
    purpose: 'email_verify',
    userId,
    ip: c.req.header('x-forwarded-for') ?? null,
  })
  const url = `${webBase(c.req.header('origin'))}/verify-email?token=${encodeURIComponent(token)}`
  const rendered = renderVerifyEmail({ url, expiresAt })
  try {
    await sendEmail({
      to: email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { template_id: rendered.templateId, purpose: 'email_verify' },
    })
  } catch (err) {
    logger.error({ err, email_sha: hashToken(email).slice(0, 16) }, 'verify_email.send_failed')
  }
  return { token, expiresAt }
}

/** Dev/test only: surface the token inline so integration tests (and local dev
 *  without a mailbox) can complete the flow. NEVER set in production. */
const DEBUG_INLINE_TOKEN = (): boolean => process.env['AUTH_RETURN_MAGIC_LINK'] === '1'

auth.post('/password/signup', zValidator('json', signupSchema), async (c) => {
  const input = c.req.valid('json')
  const existing = await findUserByEmail(input.email)
  if (existing) {
    return c.json({ error: { code: 'CONFLICT', message: 'email already registered' } }, 409)
  }
  const hash = await hashPassword(input.password)
  // Account is created UNVERIFIED (email_verified_at stays null). No session is
  // issued — the user must confirm their email before they can log in. This is
  // the TenderPulse-style onboarding (decisions.md 2026-06-06).
  const user = await createUser({
    email: input.email,
    fullName: input.fullName,
    passwordHash: hash,
  })
  const { token, expiresAt } = await sendVerificationEmail(c, user.email, user.id)
  return c.json(
    {
      data: {
        user: { id: user.id, email: user.email, fullName: user.fullName },
        emailVerificationRequired: true,
        verificationExpiresAt: expiresAt.toISOString(),
        ...(DEBUG_INLINE_TOKEN() ? { _debug_token: token } : {}),
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
  // Email-verification gate: a created-but-unconfirmed account cannot sign in.
  // The client surfaces a "resend confirmation" affordance on this code.
  if (!user.emailVerifiedAt) {
    return c.json(
      {
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Please confirm your email before signing in. Check your inbox.',
        },
      },
      403,
    )
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
  // MFA gate: a user with 2FA on does NOT get a session from password alone —
  // we issue a short-lived challenge token; /mfa/verify exchanges it + a TOTP
  // (or recovery) code for the session. The grant was already validated above.
  if (user.mfaEnabled) {
    const challengeToken = await signMfaChallenge({
      sub: user.id,
      audience,
      tenantId: audience === 'tenant' ? input.tenantId! : null,
    })
    return c.json({ data: { mfaRequired: true, challengeToken } })
  }
  return issueSession(c, user, audience, audience === 'tenant' ? input.tenantId! : null)
})

/**
 * Open a session for any audience + set the cookie, returning the standard
 * { user, session } envelope. Shared by /password/login (non-MFA) + /mfa/verify.
 */
async function issueSession(
  c: Context,
  user: { id: string; email: string; fullName: string },
  audience: SessionAudience['audience'],
  tenantId: string | null,
) {
  const { token, expiresAt } = await createSession({
    userId: user.id,
    audience,
    tenantId: tenantId ?? undefined,
    ip: c.req.header('x-forwarded-for') ?? null,
    userAgent: c.req.header('user-agent') ?? null,
  })
  setSessionCookie(c, token, expiresAt)
  const tokens = await signTokens({ sub: user.id, audience, tenantId, sessionId: hashToken(token) })
  return c.json({
    data: {
      user: { id: user.id, email: user.email, fullName: user.fullName },
      session: { token, ...tokens },
    },
  })
}

/**
 * Open an attendee session for a user + set the cookie. Shared by the
 * verify-email and password-reset consume paths (both prove email control, so
 * they log the user straight in as an attendee — tenant/super-admin context is
 * entered later via the context switcher under audience-grant authority).
 */
async function openAttendeeSession(
  c: Context,
  user: { id: string; email: string; fullName: string },
) {
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
  return c.json({
    data: {
      user: { id: user.id, email: user.email, fullName: user.fullName },
      session: { token, ...tokens },
    },
  })
}

const emailOnlySchema = z.object({ email: z.string().email().toLowerCase().trim() })
const tokenOnlySchema = z.object({ token: z.string().min(20) })

// POST /verify-email/request — (re)send the confirmation email. Always 202
// (no account enumeration); only sends for an existing, still-unverified user.
auth.post('/verify-email/request', zValidator('json', emailOnlySchema), async (c) => {
  const { email } = c.req.valid('json')
  const user = await findUserByEmail(email)
  if (user && !user.emailVerifiedAt) {
    await sendVerificationEmail(c, user.email, user.id)
  }
  return c.json({ data: { delivered: true } }, 202)
})

// POST /verify-email/consume — confirm the address from the emailed link, then
// log the user in. The token's purpose MUST be 'email_verify'.
auth.post('/verify-email/consume', zValidator('json', tokenOnlySchema), async (c) => {
  const { token } = c.req.valid('json')
  const result = await consumeMagicLink(token, c.req.header('x-forwarded-for') ?? null)
  if (!result || result.purpose !== 'email_verify') {
    return c.json({ error: { code: 'AUTH_REQUIRED', message: 'invalid or expired link' } }, 401)
  }
  const user = await findUserByEmail(result.email)
  if (!user) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'no account for this email' } }, 404)
  }
  await markEmailVerified(user.id)
  return openAttendeeSession(c, user)
})

// POST /password/forgot — email a reset link. Always 202 (no enumeration).
auth.post('/password/forgot', zValidator('json', emailOnlySchema), async (c) => {
  const { email } = c.req.valid('json')
  const user = await findUserByEmail(email)
  let debugToken: string | null = null
  if (user) {
    const { token, expiresAt } = await requestMagicLink({
      email: user.email,
      purpose: 'password_reset',
      userId: user.id,
      ip: c.req.header('x-forwarded-for') ?? null,
    })
    debugToken = token
    const url = `${webBase(c.req.header('origin'))}/reset-password?token=${encodeURIComponent(token)}`
    const rendered = renderResetPassword({ url, expiresAt })
    try {
      await sendEmail({
        to: user.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        tags: { template_id: rendered.templateId, purpose: 'password_reset' },
      })
    } catch (err) {
      logger.error(
        { err, email_sha: hashToken(user.email).slice(0, 16) },
        'password_reset.send_failed',
      )
    }
  }
  return c.json(
    {
      data: {
        delivered: true,
        ...(DEBUG_INLINE_TOKEN() && debugToken ? { _debug_token: debugToken } : {}),
      },
    },
    202,
  )
})

const resetSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8).max(200),
})

// POST /password/reset — consume the reset token, set the new password, and log
// the user in. A successful reset also confirms email control, so it verifies a
// still-unverified account. The token's purpose MUST be 'password_reset'.
auth.post('/password/reset', zValidator('json', resetSchema), async (c) => {
  const input = c.req.valid('json')
  const result = await consumeMagicLink(input.token, c.req.header('x-forwarded-for') ?? null)
  if (!result || result.purpose !== 'password_reset') {
    return c.json({ error: { code: 'AUTH_REQUIRED', message: 'invalid or expired link' } }, 401)
  }
  const user = await findUserByEmail(result.email)
  if (!user) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'no account for this email' } }, 404)
  }
  await setPassword(user.id, await hashPassword(input.password))
  // Reset proves control of the inbox → treat the address as verified.
  if (!user.emailVerifiedAt) await markEmailVerified(user.id)
  // Invalidate any other sessions (a reset is also the "I've been compromised"
  // lever) before opening a fresh one.
  await revokeAllUserSessions(user.id)
  return openAttendeeSession(c, user)
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

// ─── MFA / TOTP (§5.2, QA P2) ───────────────────────────────────────────

// `code` accepts a 6-digit TOTP OR a recovery code (128-bit, formatted with
// dashes → up to ~35 chars). max(40) keeps headroom for both.
const codeSchema = z.object({ code: z.string().min(6).max(40) })

/** Try a 6-digit TOTP, then fall back to a single-use recovery code. */
async function verifyMfaCode(userId: string, secret: string, code: string): Promise<boolean> {
  if (verifyTotp(secret, code)) return true
  return consumeRecoveryCode(userId, hashRecoveryCode(code))
}

// GET /mfa/status — is MFA on for me? (settings UI)
auth.get('/mfa/status', requireUser, async (c) => {
  const state = await getMfaState(c.get('auth')!.sub)
  return c.json({ data: { enabled: state?.enabled ?? false } })
})

// POST /mfa/enroll — start setup: provisional secret + QR (NOT enabled yet).
auth.post('/mfa/enroll', requireUser, async (c) => {
  const claims = c.get('auth')!
  const state = await getMfaState(claims.sub)
  if (state?.enabled) {
    return c.json({ error: { code: 'CONFLICT', message: 'MFA is already enabled' } }, 409)
  }
  const secret = generateTotpSecret()
  await setMfaSecret(claims.sub, secret)
  // The otpauth label uses the account id; the app shows it as "Event Pulse".
  const otpauthUri = buildOtpauthUri(`user-${claims.sub.slice(0, 8)}`, secret)
  const qrDataUrl = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 })
  return c.json({ data: { secret, otpauthUri, qrDataUrl } })
})

// POST /mfa/confirm — finish setup: a valid code turns MFA on + returns recovery codes.
auth.post('/mfa/confirm', requireUser, zValidator('json', codeSchema), async (c) => {
  const claims = c.get('auth')!
  const state = await getMfaState(claims.sub)
  if (!state?.secret) {
    return c.json({ error: { code: 'CONFLICT', message: 'start enrollment first' } }, 409)
  }
  if (state.enabled) {
    return c.json({ error: { code: 'CONFLICT', message: 'MFA already enabled' } }, 409)
  }
  if (!verifyTotp(state.secret, c.req.valid('json').code)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'incorrect code' } }, 400)
  }
  const { codes, hashes } = generateRecoveryCodes()
  await enableMfa(claims.sub, hashes)
  return c.json({ data: { enabled: true, recoveryCodes: codes } })
})

// POST /mfa/disable — turn MFA off (requires a current code or recovery code).
auth.post('/mfa/disable', requireUser, zValidator('json', codeSchema), async (c) => {
  const claims = c.get('auth')!
  const state = await getMfaState(claims.sub)
  if (!state?.enabled || !state.secret) {
    return c.json({ error: { code: 'CONFLICT', message: 'MFA is not enabled' } }, 409)
  }
  if (!(await verifyMfaCode(claims.sub, state.secret, c.req.valid('json').code))) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'incorrect code' } }, 400)
  }
  await disableMfa(claims.sub)
  return c.json({ data: { enabled: false } })
})

const mfaVerifySchema = z.object({
  challengeToken: z.string().min(20),
  code: z.string().min(6).max(40), // TOTP or a recovery code (see codeSchema)
})

// POST /mfa/verify — the login second factor: exchange the challenge + a code
// for a session (the audience/tenant grant was validated at /password/login).
auth.post('/mfa/verify', zValidator('json', mfaVerifySchema), async (c) => {
  const input = c.req.valid('json')
  const challenge = await verifyMfaChallenge(input.challengeToken)
  if (!challenge) {
    return c.json({ error: { code: 'AUTH_REQUIRED', message: 'challenge expired' } }, 401)
  }
  const state = await getMfaState(challenge.sub)
  if (!state?.enabled || !state.secret) {
    return c.json({ error: { code: 'AUTH_REQUIRED', message: 'MFA not set up' } }, 401)
  }
  if (!(await verifyMfaCode(challenge.sub, state.secret, input.code))) {
    return c.json({ error: { code: 'AUTH_REQUIRED', message: 'incorrect code' } }, 401)
  }
  const user = await findUserById(challenge.sub)
  if (!user) {
    return c.json({ error: { code: 'AUTH_REQUIRED', message: 'account not found' } }, 401)
  }
  return issueSession(c, user, challenge.audience, challenge.tenantId)
})

export { auth as authRoutes }

/**
 * OAuth (Google) callback routes for Sprint 2 Item 4. Mounted at
 * /api/v1/auth/oauth/google/{start,callback}.
 *
 * Apple Sign-In was DROPPED from MVP scope (Sprint 3 Day 23 decision —
 * see decisions.md "Apple Sign-In dropped from MVP scope"). Apple
 * routes, helpers, and frontend wiring removed; the `apple` literal
 * survives in shared types (oauth_identities.provider DB CHECK enum
 * still allows it for historical rows, type `OAuthProvider = 'google'
 * | 'apple'` retained for forward-compat) but no runtime path emits
 * 'apple'. Re-introducing Apple is a deliberate Phase 2+ decision +
 * dedicated PR; do not re-add piecemeal.
 *
 * Security model — full rationale in `.claude/memory/decisions.md`
 * "OAuth callback security model" (2026-05-17). Summary:
 *
 *   1. State cookie is HMAC-signed (derived from JWT_ACCESS_SECRET,
 *      domain-separated tag `oauth-state-v1`), TTL 10 min, single-use
 *      (cleared on callback before any DB write).
 *   2. PKCE on for Google (verifier ships inside the signed state
 *      cookie).
 *   3. ID tokens always verified via JWKS (`verifyGoogleIdToken`);
 *      never trust claims from `decodeIdToken`.
 *   4. Auto-link match order: by oauth_identities (provider, sub)
 *      first; then by users.email if email is verified AND not a
 *      relay; otherwise create a new user with whatever email the
 *      IdP provided.
 *
 * Why this file lives separately from auth.ts: the file comment in
 * auth.ts ("OAuth routes are wired in `oauth-routes.ts` and folded
 * into this router when the OAuth env is present") set the contract.
 */

import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { generateCodeVerifier, generateState, OAuth2RequestError } from 'arctic'

import { signTokens } from '../auth/jwt.js'
import { createSession } from '../auth/sessions.js'
import { hashToken } from '../auth/tokens.js'
import {
  decideAutoLink,
  googleClient,
  isOAuthProviderConfigured,
  verifyGoogleIdToken,
  type GoogleIdClaims,
} from '../auth/oauth.js'
import {
  buildClearCookie,
  buildSetCookie,
  signState,
  stateCookieName,
  verifyState,
} from '../auth/oauth-state.js'
import {
  createUser,
  findUserByEmail,
  findUserByOAuthIdentity,
  linkOAuthIdentity,
  type OAuthProvider,
  type UserRecord,
} from '../auth/users.js'
import { logger } from '../lib/logger.js'

const oauth = new Hono()

const GOOGLE_SCOPES = ['openid', 'email', 'profile']

function isSecureCookieEnv(): boolean {
  return process.env['NODE_ENV'] === 'production'
}

function fail(reason: string, requestId: string | undefined) {
  // One generic shape returned to the client — never leaks state-cookie
  // failure details. The reason ends up in logs only.
  return {
    error: {
      code: 'OAUTH_CALLBACK_FAILED',
      message: 'OAuth callback failed; please try signing in again.',
      request_id: requestId ?? null,
      _internal_reason: reason,
    },
  }
}

// ─── GOOGLE ──────────────────────────────────────────────────────────────

oauth.get('/google/start', (c) => {
  if (!isOAuthProviderConfigured('google')) {
    return c.json(
      {
        error: {
          code: 'OAUTH_NOT_CONFIGURED',
          message:
            'Google sign-in is not configured for this environment. Credentials are still being provisioned.',
        },
      },
      503,
    )
  }
  const state = generateState()
  const codeVerifier = generateCodeVerifier()
  const url = googleClient().createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES)

  const cookie = signState({ state, codeVerifier, provider: 'google' })
  c.header(
    'Set-Cookie',
    buildSetCookie(stateCookieName('google'), cookie, { secure: isSecureCookieEnv() }),
  )
  return c.redirect(url.toString(), 302)
})

oauth.get('/google/callback', async (c) => {
  const requestId = c.req.header('x-request-id') ?? undefined
  const url = new URL(c.req.url)
  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  const idpError = url.searchParams.get('error')
  const cookie = c.req.header('cookie')
  const cookieValue = readCookie(cookie, stateCookieName('google'))

  // Always clear the state cookie before any further processing —
  // single-use enforcement on our side. Belt-and-braces with the IdP's
  // own single-use code enforcement.
  c.header(
    'Set-Cookie',
    buildClearCookie(stateCookieName('google'), { secure: isSecureCookieEnv() }),
  )

  if (idpError) {
    logger.info({ request_id: requestId, idp_error: idpError }, 'google oauth user cancelled')
    return c.json(fail(`idp_error:${idpError}`, requestId), 400)
  }
  if (!code || !stateParam) {
    return c.json(fail('missing code or state in callback', requestId), 400)
  }
  const verified = verifyState(cookieValue, 'google', stateParam)
  if (!verified.ok) {
    logger.warn({ request_id: requestId, reason: verified.error }, 'google state verify failed')
    return c.json(fail(`state:${verified.error}`, requestId), 400)
  }

  let idToken: string
  try {
    const tokens = await googleClient().validateAuthorizationCode(
      code,
      verified.payload.codeVerifier,
    )
    idToken = tokens.idToken()
  } catch (err) {
    if (err instanceof OAuth2RequestError) {
      logger.warn(
        { request_id: requestId, err_code: err.code, err_desc: err.description },
        'google code exchange rejected',
      )
      return c.json(fail(`code_exchange:${err.code}`, requestId), 400)
    }
    throw err
  }

  let claims: GoogleIdClaims
  try {
    claims = await verifyGoogleIdToken(idToken)
  } catch (err) {
    logger.warn(
      { request_id: requestId, err: err instanceof Error ? err.message : String(err) },
      'google id token verify failed',
    )
    return c.json(fail('id_token_verify_failed', requestId), 400)
  }

  const session = await loginOrLink({
    provider: 'google',
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.emailVerified,
    isPrivateEmail: false,
    nameForNewUser: claims.name,
    ip: c.req.header('x-forwarded-for') ?? null,
    userAgent: c.req.header('user-agent') ?? null,
    rawProfile: {
      sub: claims.sub,
      email: claims.email,
      email_verified: claims.emailVerified,
      name: claims.name,
      picture: claims.picture,
    },
  })

  // Set the attendee session cookie on the response. The plaintext
  // token doubles as the cookie value; the existing auth middleware
  // expects this same cookie name (`eventpulse_session`).
  setCookie(c, 'eventpulse_session', session.sessionToken, {
    httpOnly: true,
    secure: isSecureCookieEnv(),
    sameSite: 'Lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  })
  return c.json({ data: session.responseBody }, 200)
})

// Apple routes removed Day 23 per "Apple Sign-In dropped from MVP scope"
// decision. To re-add, restore /apple/start (GET) + /apple/callback (POST)
// and reinstate appleClient + verifyAppleIdToken usage. See git history
// commit removing this section for the full prior implementation.

// ─── shared post-verify flow ────────────────────────────────────────────

interface LoginOrLinkInput {
  provider: OAuthProvider
  sub: string
  email: string | null
  emailVerified: boolean
  isPrivateEmail: boolean
  nameForNewUser: string | null
  ip: string | null
  userAgent: string | null
  rawProfile: Record<string, unknown>
}

interface LoginOrLinkResult {
  sessionToken: string
  responseBody: {
    user: { id: string; email: string; fullName: string }
    session: {
      token: string
      accessToken: string
      refreshToken: string
      accessExpiresIn: number
      refreshExpiresIn: number
    }
    flow: 'signed-in-existing' | 'linked-to-existing' | 'new-user'
  }
}

async function loginOrLink(input: LoginOrLinkInput): Promise<LoginOrLinkResult> {
  // Step 1 — primary match: (provider, provider_user_id). For Apple
  // this is the ONLY stable identifier; for Google it's also faster
  // than an email lookup once a user has used Google sign-in once.
  const existing = await findUserByOAuthIdentity(input.provider, input.sub)
  if (existing) {
    return finalize(existing.user, 'signed-in-existing', input)
  }

  // Step 2 — auto-link or new user, per the pure-function decision.
  const candidateUser =
    input.email && !input.isPrivateEmail ? await findUserByEmail(input.email) : null
  const decision = decideAutoLink({
    providerUserId: input.sub,
    email: input.email,
    emailVerified: input.emailVerified,
    isPrivateEmail: input.isPrivateEmail,
    existingUserWithEmailId: candidateUser?.id ?? null,
  })

  if (decision.action === 'link-to-existing') {
    await linkOAuthIdentity({
      userId: candidateUser!.id,
      provider: input.provider,
      providerUserId: input.sub,
      email: input.email,
      rawProfile: input.rawProfile,
    })
    return finalize(candidateUser!, 'linked-to-existing', input)
  }

  // Step 3 — create new user. Email may be a relay (Apple) or whatever
  // the IdP provided. Name: from form_post `user` blob (Apple) or
  // ID-token claim (Google); fall back to "OAuth User" so we never NULL
  // the column.
  const newEmail = input.email ?? `${input.sub}@${input.provider}.oauth.eventpulse.local`
  const newUser = await createUser({
    email: newEmail,
    fullName: input.nameForNewUser ?? 'OAuth User',
    passwordHash: null,
  })
  await linkOAuthIdentity({
    userId: newUser.id,
    provider: input.provider,
    providerUserId: input.sub,
    email: input.email,
    rawProfile: input.rawProfile,
  })
  return finalize(newUser, 'new-user', input)
}

async function finalize(
  user: UserRecord,
  flow: LoginOrLinkResult['responseBody']['flow'],
  input: LoginOrLinkInput,
): Promise<LoginOrLinkResult> {
  const { token: sessionToken } = await createSession({
    userId: user.id,
    audience: 'attendee',
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
  const tokens = await signTokens({
    sub: user.id,
    audience: 'attendee',
    tenantId: null,
    sessionId: hashToken(sessionToken),
  })
  return {
    sessionToken,
    responseBody: {
      user: { id: user.id, email: user.email, fullName: user.fullName },
      session: { token: sessionToken, ...tokens },
      flow,
    },
  }
}

// ─── small parsing helper ───────────────────────────────────────────────

function readCookie(headerValue: string | undefined, name: string): string | null {
  if (!headerValue) return null
  for (const segment of headerValue.split(';')) {
    const trimmed = segment.trim()
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1)
  }
  return null
}

export const oauthRoutes = oauth

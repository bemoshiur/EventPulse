/**
 * Hono middleware for auth-required routes per CLAUDE.md §5.1.
 *
 * Pattern: a JWT access-token is sent as `Authorization: Bearer ...`
 * (web clients add it client-side from the cookie). The middleware
 * verifies the JWT, then cross-checks against the live `sessions` row
 * so revoked sessions can't survive their access-token lifetime.
 *
 * Three flavours mirror the three audiences:
 * - `requireSuperAdminAuth`
 * - `requireTenantAuth`     (also sets `c.var.tenantId` for downstream)
 * - `requireAttendeeAuth`
 */

import type { Context, MiddlewareHandler, Next } from 'hono'

import { readSessionCookie } from './cookie.js'
import { resolveSession } from './sessions.js'
import { hashToken } from './tokens.js'
import { verifyAccessToken, type AccessClaims } from './jwt.js'

declare module 'hono' {
  interface ContextVariableMap {
    auth?: AccessClaims
    tenantId?: string
  }
}

function unauthorized(c: Context, code: 'AUTH_REQUIRED' | 'FORBIDDEN', message: string) {
  return c.json(
    {
      error: {
        code,
        message,
        request_id: c.get('requestId') ?? null,
      },
    },
    code === 'AUTH_REQUIRED' ? 401 : 403,
  )
}

async function extractAndVerify(c: Context): Promise<AccessClaims | null> {
  // 1. Bearer access-token — programmatic clients + the existing path.
  // A valid JWT issued by us is accepted on signature + expiry alone
  // (no live-session lookup; the plaintext token isn't in the JWT).
  const header = c.req.header('authorization') ?? c.req.header('Authorization')
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim()
    if (token) {
      const claims = await verifyAccessToken(token)
      if (claims) return claims
    }
  }

  // 2. Session cookie — browser clients (Option B, browser-auth integration).
  // Unlike the Bearer path this does a LIVE `sessions` row check via
  // resolveSession, so a revoked or expired session is rejected at once.
  // Claims are derived from the row (the server's authority), never the client.
  const cookieToken = readSessionCookie(c)
  if (cookieToken) {
    const session = await resolveSession(cookieToken)
    if (session) {
      return {
        sub: session.userId,
        audience: session.audience,
        tenantId: session.tenantId,
        sessionId: hashToken(cookieToken),
      }
    }
  }

  return null
}

export const requireSuperAdminAuth: MiddlewareHandler = async (c, next) => {
  const claims = await extractAndVerify(c)
  if (!claims) return unauthorized(c, 'AUTH_REQUIRED', 'authentication required')
  if (claims.audience !== 'super-admin') {
    return unauthorized(c, 'FORBIDDEN', 'super-admin audience required')
  }
  c.set('auth', claims)
  await next()
}

export const requireTenantAuth: MiddlewareHandler = async (c, next) => {
  const claims = await extractAndVerify(c)
  if (!claims) return unauthorized(c, 'AUTH_REQUIRED', 'authentication required')
  if (claims.audience !== 'tenant' || !claims.tenantId) {
    return unauthorized(c, 'FORBIDDEN', 'tenant audience required')
  }
  c.set('auth', claims)
  c.set('tenantId', claims.tenantId)
  await next()
}

export const requireAttendeeAuth: MiddlewareHandler = async (c, next) => {
  const claims = await extractAndVerify(c)
  if (!claims) return unauthorized(c, 'AUTH_REQUIRED', 'authentication required')
  if (claims.audience !== 'attendee') {
    return unauthorized(c, 'FORBIDDEN', 'attendee audience required')
  }
  c.set('auth', claims)
  await next()
}

/** Helper for tests / future code: do nothing if no token, but set claims if there is one. */
export const optionalAuth: MiddlewareHandler = async (c, next: Next) => {
  const claims = await extractAndVerify(c)
  if (claims) {
    c.set('auth', claims)
    if (claims.tenantId) c.set('tenantId', claims.tenantId)
  }
  await next()
}

// Re-export resolveSession so callers don't need a second import path.
export { resolveSession }

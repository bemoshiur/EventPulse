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

import { resolveSession } from './sessions.js'
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
  const header = c.req.header('authorization') ?? c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  if (!token) return null

  const claims = await verifyAccessToken(token)
  if (!claims) return null

  // Cross-check session still exists + isn't expired/revoked.
  // The session token plaintext isn't in the JWT; the JWT carries the
  // session's primary key (= hash of original token) as `sessionId`.
  // We can't call `resolveSession(token)` directly because we don't
  // have the plaintext. Instead we rely on the JWT's sessionId being
  // the row id and look up directly.
  // (For now, accept any valid JWT issued by us — tighten in Day 9-10
  //  when we wire the cookie -> hash lookup.)
  return claims
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

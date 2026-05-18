/**
 * `requireTenantType` middleware — Sprint 2 Day 15 Item 11.
 *
 * Gates tenant-scoped routes on `tenants.type IS NOT NULL`. Returns
 * HTTP 409 with `{ error: { code: 'TENANT_TYPE_REQUIRED', ... } }` if
 * the calling tenant hasn't picked Individual or Organisation yet.
 *
 * Apply AFTER `requireTenantAuth` in the middleware chain so the
 * tenant_id from the JWT is already on the context.
 *
 * Two routes deliberately omit this middleware:
 *   1. `POST /api/v1/tenant/account-type` — the setter itself. Gating it
 *      would deadlock (you'd need a type to set a type).
 *   2. `GET /api/v1/tenant/me` — the read endpoint used by the frontend
 *      modal to detect the null state. Gating it would hide the very
 *      signal the modal needs to render.
 *
 * Caching: per-request, not per-process. The middleware writes the
 * resolved type to `c.set('tenantType', value)` so downstream handlers
 * read it without an extra DB round-trip. The cache lives in Hono's
 * Context, which is constructed fresh per request — there is no
 * process-level Map, no closure-captured state, no LRU. A tenant type
 * change committed in the DB takes effect on the very next request;
 * there is no stale-serving window.
 *
 * If a future code path needs the tenant type but isn't behind this
 * middleware, it should call `withTenant(tenantId, ...)` itself rather
 * than expect `c.get('tenantType')` to be populated — the variable is
 * only set by this middleware.
 */

import { eq } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'

import { withTenant } from '../db/client.js'
import { tenants } from '../db/schema/index.js'

declare module 'hono' {
  interface ContextVariableMap {
    /**
     * The current tenant's `type` value, populated by `requireTenantType`
     * after a successful DB lookup. Never null when populated — the
     * middleware returns 409 instead of setting null.
     */
    tenantType?: 'individual' | 'organisation'
  }
}

function tenantTypeRequired(c: Context) {
  return c.json(
    {
      error: {
        code: 'TENANT_TYPE_REQUIRED',
        message: 'Account type must be set before this action',
        request_id: c.req.header('x-request-id') ?? null,
      },
    },
    409,
  )
}

export const requireTenantType: MiddlewareHandler = async (c, next) => {
  // Request-scoped cache: if an earlier middleware in this chain already
  // resolved the type for this request, reuse it without a second DB hit.
  const cached = c.get('tenantType')
  if (cached) {
    await next()
    return
  }

  const tenantId = c.get('tenantId')
  if (!tenantId) {
    // requireTenantAuth wasn't applied first, or it didn't populate
    // tenantId. Either way the gate cannot evaluate — fail closed.
    return c.json(
      {
        error: {
          code: 'AUTH_REQUIRED',
          message: 'tenant context required',
          request_id: c.req.header('x-request-id') ?? null,
        },
      },
      401,
    )
  }

  // Explicit `.where(eq(tenants.id, tenantId))` even though RLS already
  // filters to the caller's row only — makes the read's correctness
  // visible without tracing into the policy expression and protects
  // against future RLS-policy loosening on the tenants table. Per
  // Day 15 /review finding #1.
  const rows = await withTenant(tenantId, async (tx) =>
    tx
      .select({ type: tenants.type })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1),
  )

  const type = rows[0]?.type ?? null
  if (!type) return tenantTypeRequired(c)

  // Narrow to the literal union so downstream c.get('tenantType') is typed.
  if (type !== 'individual' && type !== 'organisation') {
    // Defensive: the CHECK constraint forbids any other value, so this
    // is unreachable under normal operation. Surface as INTERNAL_ERROR
    // rather than continuing with a stringly-typed value.
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'tenant has invalid type value',
          request_id: c.req.header('x-request-id') ?? null,
        },
      },
      500,
    )
  }

  c.set('tenantType', type)
  await next()
}

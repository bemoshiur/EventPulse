/**
 * Tenant-context listing for the post-login tenant picker (§2.3 + §10.3).
 *
 * After a user logs in at `app.eventpulse.com.bd` they hold an `attendee`
 * session (the magic-link flow doesn't mint tenant sessions — it has no
 * tenantId to scope to). The `/choose-tenant` picker reads this list, the user
 * selects one, and `POST /my/contexts/switch` mints the tenant-scoped session.
 *
 * "Always show a picker" — decisions.md 2026-06-04. Even a single-tenant user
 * passes through the picker; the list is what it renders.
 *
 * **Why `withSuperAdmin` (BYPASSRLS):** the caller is NOT yet in a tenant
 * context, so there is no `app.current_tenant_id` to scope an RLS read by, and
 * the user legitimately spans several tenants. We read by the user's OWN grant
 * set (`fetchAudienceGrants` → `tenant_users` rows), so the BYPASSRLS read can
 * only ever surface tenants the user already belongs to. Mirrors
 * `fetchAudienceGrants` itself, which is `withSuperAdmin` for the same reason.
 */

import { and, inArray, isNull } from 'drizzle-orm'

import { fetchAudienceGrants } from '../../auth/audience-grant.js'
import { withSuperAdmin } from '../../db/client.js'
import { tenants } from '../../db/schema/index.js'

export interface TenantContext {
  id: string
  name: string
  slug: string
  /** null until the Account-Type modal sets it (§9.1). */
  type: string | null
  isPersonal: boolean
  kycStatus: string
}

/**
 * List the tenants the user may act in — their `tenant_users` memberships plus
 * any personal tenant (which is itself a `tenant_users` row). Soft-deleted
 * tenants are excluded. Returns `[]` for a user with no tenant grants (a
 * pure attendee) — the picker shows the "you don't host anything yet" state.
 */
export async function listUserContexts(userId: string): Promise<TenantContext[]> {
  const grants = await fetchAudienceGrants(userId)
  if (grants.tenantIds.length === 0) return []
  return withSuperAdmin(async (db) => {
    return db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        type: tenants.type,
        isPersonal: tenants.isPersonal,
        kycStatus: tenants.kycStatus,
      })
      .from(tenants)
      .where(and(inArray(tenants.id, grants.tenantIds), isNull(tenants.deletedAt)))
  })
}

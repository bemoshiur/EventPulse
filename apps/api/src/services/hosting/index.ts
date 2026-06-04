/**
 * Self-service hosting — personal-tenant provisioning (§2.3 / §2.4 Path A).
 *
 * When a signed-in user starts hosting, we auto-provision a "personal tenant"
 * (an individual tenant they solely own) so the multi-tenant model is unchanged
 * while the user just sees "I'm hosting an event." Free events publish without
 * KYC (§13.5), so the personal tenant is born `active`; the KYC gate triggers
 * later at "add paid tier", not here.
 *
 * `withSuperAdmin` (BYPASSRLS): the caller has no tenant context yet, so there
 * is no `app.current_tenant_id` to scope the insert by — same pattern as the
 * context picker. The write is keyed to the caller's own userId.
 */

import { and, eq, isNull } from 'drizzle-orm'

import { deriveDisplayName } from '../../auth/display-name.js'
import { withSuperAdmin } from '../../db/client.js'
import { reservedHandles, tenants, tenantUsers, users } from '../../db/schema/index.js'
import { derivePersonalSlug } from './slug.js'

export { derivePersonalSlug }

export interface PersonalTenant {
  id: string
  slug: string
  name: string
}

/**
 * Return the user's personal tenant, creating it on first call. Idempotent: a
 * user who already owns a personal tenant gets it back unchanged.
 */
export async function ensurePersonalTenant(userId: string): Promise<PersonalTenant> {
  return withSuperAdmin(async (db) => {
    // 1) Already provisioned?
    const existing = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(
        and(
          eq(tenants.ownerUserId, userId),
          eq(tenants.isPersonal, true),
          isNull(tenants.deletedAt),
        ),
      )
      .limit(1)
    if (existing[0]) return existing[0]

    // 2) Look up the user for the name + slug seed.
    const userRows = await db
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    const user = userRows[0]
    if (!user) throw new Error(`ensurePersonalTenant: user ${userId} not found`)
    const name = user.fullName?.trim() || deriveDisplayName(user.email)

    // Is `slug` already taken across the shared handle namespace (§2.3)?
    const isSlugTaken = async (slug: string): Promise<boolean> => {
      const t = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1)
      if (t.length > 0) return true
      const u = await db.select({ id: users.id }).from(users).where(eq(users.handle, slug)).limit(1)
      if (u.length > 0) return true
      const r = await db
        .select({ h: reservedHandles.handle })
        .from(reservedHandles)
        .where(eq(reservedHandles.handle, slug))
        .limit(1)
      return r.length > 0
    }

    // 3) Unique slug across the shared namespace.
    const base = derivePersonalSlug(user.email)
    let slug = base
    for (let i = 2; i <= 50; i += 1) {
      if (!(await isSlugTaken(slug))) break
      slug = `${base}-${i}`.slice(0, 30).replace(/-+$/g, '')
    }

    // 4) Create the personal tenant + the owner membership.
    const inserted = await db
      .insert(tenants)
      .values({
        type: 'individual', // set-once; satisfies requireTenantType (no Account-Type modal needed)
        name,
        slug,
        isPersonal: true,
        ownerUserId: userId,
        status: 'active', // free hosting allowed without KYC (§13.5); KYC gates at paid tier
        kycStatus: 'not_submitted',
      })
      .returning({ id: tenants.id, slug: tenants.slug, name: tenants.name })
    const tenant = inserted[0]!
    await db
      .insert(tenantUsers)
      .values({ tenantId: tenant.id, userId, role: 'owner', acceptedAt: new Date() })
    return tenant
  })
}

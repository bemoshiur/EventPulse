/**
 * Server-side audience-grant authority.
 *
 * Day-45 critical fix: `/password/login` + `/magic-link/consume` previously
 * trusted a client-supplied `audience`, letting any authenticated user
 * self-grant a `super-admin` session or scope a `tenant` session to an
 * arbitrary tenantId. The login handlers MUST run `decideAudience` against
 * the user's actual grants (fetched via `fetchAudienceGrants`) before
 * minting any non-attendee session.
 */
import { withSuperAdmin } from '../db/client.js'
import { superAdmins, tenantUsers } from '../db/schema/index.js'
import { eq } from 'drizzle-orm'

export interface AudienceGrants {
  /** true when the user has a row in `super_admins`. */
  isSuperAdmin: boolean
  /** tenantIds the user is a member of (rows in `tenant_users`). */
  tenantIds: string[]
}

export interface AudienceDecision {
  allowed: boolean
  /** human-readable denial reason; present only when `allowed` is false. */
  reason?: string
}

/**
 * Pure decision: may `userId-with-these-grants` open a session for `requested`?
 * - attendee: always (every signed-in user has the attendee context).
 * - super-admin: only if the user is in `super_admins`.
 * - tenant: only if `tenantId` is supplied AND the user is a member of it.
 *   Super-admin status does NOT grant arbitrary tenant access.
 */
export function decideAudience(
  requested: 'super-admin' | 'tenant' | 'attendee',
  grants: AudienceGrants,
  tenantId?: string,
): AudienceDecision {
  if (requested === 'attendee') return { allowed: true }
  if (requested === 'super-admin') {
    return grants.isSuperAdmin
      ? { allowed: true }
      : { allowed: false, reason: 'user is not a super-admin' }
  }
  // tenant
  if (!tenantId) return { allowed: false, reason: 'tenantId required for tenant audience' }
  return grants.tenantIds.includes(tenantId)
    ? { allowed: true }
    : { allowed: false, reason: 'user is not a member of this tenant' }
}

/** Fetch a user's audience grants from the DB (super_admins + tenant_users). */
export async function fetchAudienceGrants(userId: string): Promise<AudienceGrants> {
  return withSuperAdmin(async (db) => {
    const [superRows, tenantRows] = await Promise.all([
      db
        .select({ userId: superAdmins.userId })
        .from(superAdmins)
        .where(eq(superAdmins.userId, userId)),
      db
        .select({ tenantId: tenantUsers.tenantId })
        .from(tenantUsers)
        .where(eq(tenantUsers.userId, userId)),
    ])
    return {
      isSuperAdmin: superRows.length > 0,
      tenantIds: tenantRows.map((r) => r.tenantId),
    }
  })
}

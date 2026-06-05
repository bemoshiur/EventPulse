/**
 * Handle/slug rename service (§2.3 shared namespace, §9.14 handle history).
 *
 * Renaming a tenant's slug also renames the personal user's handle (they mirror
 * for is_personal tenants) and writes a `handle_history` row so the old URL can
 * 301-redirect for 30 days. Runs under `withSuperAdmin` (BYPASSRLS) because the
 * uniqueness check + the user-handle write span the shared namespace, like
 * `ensurePersonalTenant`.
 *
 * The handle contract (§2.3): lowercase, 3–30 chars, `^[a-z0-9][a-z0-9-]*[a-z0-9]$`,
 * unique across `tenants.slug` ∪ `users.handle`, and not in `reserved_handles`.
 */

import { and, eq, gt, ne, sql } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { handleHistory, reservedHandles, tenants, users } from '../../db/schema/index.js'

export class InvalidHandleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidHandleError'
  }
}
export class ReservedHandleError extends Error {
  constructor(public readonly handle: string) {
    super(`handle "${handle}" is reserved`)
    this.name = 'ReservedHandleError'
  }
}
export class HandleTakenError extends Error {
  constructor(public readonly handle: string) {
    super(`handle "${handle}" is already taken`)
    this.name = 'HandleTakenError'
  }
}
export class TenantNotFoundError extends Error {
  constructor(public readonly tenantId: string) {
    super(`tenant ${tenantId} not found`)
    this.name = 'TenantNotFoundError'
  }
}

const HANDLE_SHAPE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/

/**
 * Normalise (trim + lowercase) and validate the handle SHAPE only. Throws
 * InvalidHandleError on a bad shape. Availability/reserved are checked later
 * against the DB.
 */
export function normaliseHandle(raw: string): string {
  const slug = raw.trim().toLowerCase()
  if (slug.length < 3 || slug.length > 30) {
    throw new InvalidHandleError('Handle must be 3–30 characters.')
  }
  if (!HANDLE_SHAPE.test(slug)) {
    throw new InvalidHandleError(
      'Handle may use lowercase letters, numbers and hyphens, and must start and end with a letter or number.',
    )
  }
  return slug
}

export interface RenameTenantHandleInput {
  tenantId: string
  newSlug: string
  actorUserId: string
}

export interface RenameResult {
  slug: string
}

/**
 * Rename a tenant's slug (and the mirrored personal-user handle), recording a
 * 30-day redirect in `handle_history`. Idempotent when the target equals the
 * current slug (no history row written).
 */
export async function renameTenantHandle(input: RenameTenantHandleInput): Promise<RenameResult> {
  const next = normaliseHandle(input.newSlug)

  return withSuperAdmin(async (db) => {
    const [tenant] = await db
      .select({
        slug: tenants.slug,
        isPersonal: tenants.isPersonal,
        ownerUserId: tenants.ownerUserId,
      })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .limit(1)

    if (!tenant) throw new TenantNotFoundError(input.tenantId)

    const current = tenant.slug.toLowerCase()
    if (next === current) return { slug: tenant.slug }

    // Reserved?
    const reserved = await db
      .select({ h: reservedHandles.handle })
      .from(reservedHandles)
      .where(eq(reservedHandles.handle, next))
      .limit(1)
    if (reserved.length > 0) throw new ReservedHandleError(next)

    // Taken by another tenant's slug or another user's handle?
    const takenTenant = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.slug, next), ne(tenants.id, input.tenantId)))
      .limit(1)
    if (takenTenant.length > 0) throw new HandleTakenError(next)

    const ownerId = tenant.ownerUserId
    const takenUser = await db
      .select({ id: users.id })
      .from(users)
      .where(ownerId ? and(eq(users.handle, next), ne(users.id, ownerId)) : eq(users.handle, next))
      .limit(1)
    if (takenUser.length > 0) throw new HandleTakenError(next)

    // Apply: tenant slug, mirror onto personal user handle, and history row.
    await db.update(tenants).set({ slug: next }).where(eq(tenants.id, input.tenantId))

    if (tenant.isPersonal && ownerId) {
      await db.update(users).set({ handle: next }).where(eq(users.id, ownerId))
    }

    await db.insert(handleHistory).values({
      tenantId: input.tenantId,
      oldHandle: current,
      newHandle: next,
    })

    return { slug: next }
  })
}

/**
 * Resolve a possibly-renamed slug to its current value via `handle_history`
 * (un-expired rows only). Returns the current slug to redirect to, or null if
 * there's no live redirect for the given old slug. Used by the public event
 * route to 301 old URLs.
 */
export async function resolveHandleRedirect(oldSlug: string): Promise<string | null> {
  const slug = oldSlug.trim().toLowerCase()
  return withSuperAdmin(async (db) => {
    const rows = await db
      .select({ newHandle: handleHistory.newHandle })
      .from(handleHistory)
      .where(
        and(eq(handleHistory.oldHandle, slug), gt(handleHistory.redirectExpiresAt, sql`now()`)),
      )
      .orderBy(handleHistory.changedAt)
    // The newest un-expired row wins (handles a chain of renames within 30 days).
    const live = rows.at(-1)
    return live ? live.newHandle : null
  })
}

// re-export for callers that want the predicate
export { HANDLE_SHAPE }

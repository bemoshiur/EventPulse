/**
 * Integration tests for renameTenantHandle — the "rename your handle/slug"
 * service (§2.3 / §9.14). Mirrors the ensure-personal-tenant harness: real
 * Postgres test DB, withSuperAdmin context, create → act → assert.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import { resetPool, withSuperAdmin } from '../../db/client.js'
import { handleHistory, reservedHandles, tenants, users } from '../../db/schema/index.js'
import { ensurePersonalTenant } from '../hosting/index.js'
import {
  HandleTakenError,
  InvalidHandleError,
  ReservedHandleError,
  renameTenantHandle,
} from './index.js'

// DB integration test — runs only where DATABASE_URL is set (the CI
// integration-tests job + local Postgres); skipped in the no-DB unit job.
const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

async function makeUser(email: string): Promise<string> {
  return withSuperAdmin(async (db) => {
    const [u] = await db
      .insert(users)
      .values({ email, fullName: email.split('@')[0] ?? 'Test' })
      .returning({ id: users.id })
    return u!.id
  })
}

afterAll(async () => {
  await resetPool()
})

describeIfDb('renameTenantHandle', () => {
  let userId: string
  let tenantId: string
  let originalSlug: string

  beforeEach(async () => {
    userId = await makeUser(`rename-${Date.now()}-${Math.round(Math.random() * 1e9)}@example.com`)
    const t = await ensurePersonalTenant(userId)
    tenantId = t.id
    originalSlug = t.slug
  })

  it('renames the tenant slug and mirrors it onto the personal user handle', async () => {
    const target = `mybrand-${Math.round(Math.random() * 1e9)}`.slice(0, 28)
    const result = await renameTenantHandle({ tenantId, newSlug: target, actorUserId: userId })

    expect(result.slug).toBe(target)

    const [tenant] = await withSuperAdmin((db) =>
      db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)),
    )
    expect(tenant!.slug).toBe(target)

    const [user] = await withSuperAdmin((db) =>
      db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)),
    )
    expect(user!.handle).toBe(target)
  })

  it('writes a handle_history row so the old slug can redirect', async () => {
    const target = `redir-${Math.round(Math.random() * 1e9)}`.slice(0, 28)
    await renameTenantHandle({ tenantId, newSlug: target, actorUserId: userId })

    const rows = await withSuperAdmin((db) =>
      db.select().from(handleHistory).where(eq(handleHistory.tenantId, tenantId)),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.oldHandle).toBe(originalSlug)
    expect(rows[0]!.newHandle).toBe(target)
  })

  it('rejects an invalid handle shape', async () => {
    await expect(
      renameTenantHandle({ tenantId, newSlug: 'No Spaces!', actorUserId: userId }),
    ).rejects.toBeInstanceOf(InvalidHandleError)
  })

  it('rejects a too-short handle', async () => {
    await expect(
      renameTenantHandle({ tenantId, newSlug: 'ab', actorUserId: userId }),
    ).rejects.toBeInstanceOf(InvalidHandleError)
  })

  it('rejects a reserved handle', async () => {
    await withSuperAdmin(async (db) => {
      await db
        .insert(reservedHandles)
        .values({ handle: 'admin', reason: 'system' })
        .onConflictDoNothing()
    })
    await expect(
      renameTenantHandle({ tenantId, newSlug: 'admin', actorUserId: userId }),
    ).rejects.toBeInstanceOf(ReservedHandleError)
  })

  it('rejects a handle already taken by another tenant', async () => {
    const otherUser = await makeUser(`other-${Date.now()}@example.com`)
    const other = await ensurePersonalTenant(otherUser)
    await expect(
      renameTenantHandle({ tenantId, newSlug: other.slug, actorUserId: userId }),
    ).rejects.toBeInstanceOf(HandleTakenError)
  })

  it('is a no-op when renaming to the current slug (no history row)', async () => {
    const result = await renameTenantHandle({
      tenantId,
      newSlug: originalSlug,
      actorUserId: userId,
    })
    expect(result.slug).toBe(originalSlug)
    const rows = await withSuperAdmin((db) =>
      db.select().from(handleHistory).where(eq(handleHistory.tenantId, tenantId)),
    )
    expect(rows).toHaveLength(0)
  })
})

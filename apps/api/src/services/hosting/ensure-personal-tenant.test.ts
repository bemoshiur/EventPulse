/**
 * ensurePersonalTenant — DB integration test (runs in CI where DATABASE_URL is
 * set; skipped locally). Verifies the real insert path: a personal tenant +
 * owner membership are created, the row matches the §13.5 free-hosting shape,
 * and a second call is idempotent.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { resetPool, withSuperAdmin } from '../../db/client.js'
import { tenants, tenantUsers, users } from '../../db/schema/index.js'
import { ensurePersonalTenant } from './index.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('ensurePersonalTenant (integration)', () => {
  const stamp = Date.now()
  const email = `hosting-${stamp}@test.local`
  let userId: string

  beforeAll(async () => {
    userId = await withSuperAdmin(async (db) => {
      const rows = await db
        .insert(users)
        .values({ email, fullName: 'Hosting Test' })
        .returning({ id: users.id })
      return rows[0]!.id
    })
  })

  afterAll(async () => {
    await withSuperAdmin(async (db) => {
      const ts = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.ownerUserId, userId))
      for (const t of ts) {
        await db.delete(tenantUsers).where(eq(tenantUsers.tenantId, t.id))
        await db.delete(tenants).where(eq(tenants.id, t.id))
      }
      await db.delete(users).where(eq(users.id, userId))
    })
    await resetPool()
  })

  it('creates a free-hosting personal tenant + owner membership, then is idempotent', async () => {
    const t1 = await ensurePersonalTenant(userId)
    expect(t1.id).toBeTruthy()
    expect(t1.slug).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)

    const row = await withSuperAdmin(async (db) =>
      db
        .select({
          type: tenants.type,
          isPersonal: tenants.isPersonal,
          status: tenants.status,
          ownerUserId: tenants.ownerUserId,
        })
        .from(tenants)
        .where(eq(tenants.id, t1.id))
        .limit(1),
    )
    expect(row[0]).toMatchObject({
      type: 'individual',
      isPersonal: true,
      status: 'active',
      ownerUserId: userId,
    })

    const membership = await withSuperAdmin(async (db) =>
      db
        .select({ role: tenantUsers.role })
        .from(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, t1.id), eq(tenantUsers.userId, userId)))
        .limit(1),
    )
    expect(membership[0]?.role).toBe('owner')

    // Second call → same tenant, no duplicate.
    const t2 = await ensurePersonalTenant(userId)
    expect(t2.id).toBe(t1.id)
  })
})

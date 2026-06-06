import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, isNull } from 'drizzle-orm'

import { withSuperAdmin, withTenant } from '../client.js'
import { notificationLog, tenants, users } from '../schema/index.js'

/**
 * RLS isolation for notification_log (migration 0020) per CLAUDE.md §4.4.
 *
 * The table's tenant_id is nullable (system/auth emails). A tenant reading via
 * the tenant read path (§10.2, eventpulse_app) must see ONLY its own rows and
 * NEVER another tenant's — nor the NULL-tenant system rows. Delivery writes run
 * under withSuperAdmin (BYPASSRLS), exercised here to seed the fixtures.
 *
 * Skipped when DATABASE_URL is unset (local laptop); CI provisions Postgres.
 */

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('RLS — notification_log cross-tenant isolation', () => {
  const fx: { tenantA?: string; tenantB?: string; userA?: string; userB?: string } = {}

  beforeAll(async () => {
    await withSuperAdmin(async (db) => {
      const stamp = Date.now()
      const [uA] = await db
        .insert(users)
        .values({ email: `nl-a-${stamp}@test.local`, fullName: 'NL A' })
        .returning({ id: users.id })
      const [uB] = await db
        .insert(users)
        .values({ email: `nl-b-${stamp}@test.local`, fullName: 'NL B' })
        .returning({ id: users.id })
      const [tA] = await db
        .insert(tenants)
        .values({ type: 'individual', name: 'NL Tenant A', slug: `nl-a-${stamp}` })
        .returning({ id: tenants.id })
      const [tB] = await db
        .insert(tenants)
        .values({ type: 'individual', name: 'NL Tenant B', slug: `nl-b-${stamp}` })
        .returning({ id: tenants.id })
      fx.userA = uA!.id
      fx.userB = uB!.id
      fx.tenantA = tA!.id
      fx.tenantB = tB!.id

      await db.insert(notificationLog).values([
        {
          tenantId: tA!.id,
          channel: 'email',
          templateId: 'order_confirmed',
          recipientHash: 'hash-a',
          provider: 'ses',
          providerMessageId: 'ses-a',
          status: 'sent',
        },
        {
          tenantId: tB!.id,
          channel: 'email',
          templateId: 'order_confirmed',
          recipientHash: 'hash-b',
          provider: 'ses',
          providerMessageId: 'ses-b',
          status: 'sent',
        },
        {
          tenantId: null, // system email (e.g. auth magic link) — belongs to no tenant
          channel: 'email',
          templateId: 'auth_magic_link',
          recipientHash: 'hash-sys',
          provider: 'ses',
          providerMessageId: 'ses-sys',
          status: 'sent',
        },
      ])
    })
  })

  afterAll(async () => {
    if (!fx.tenantA) return
    await withSuperAdmin(async (db) => {
      // notification_log first — it FK-references tenants (no cascade).
      await db.delete(notificationLog).where(eq(notificationLog.tenantId, fx.tenantA!))
      await db.delete(notificationLog).where(eq(notificationLog.tenantId, fx.tenantB!))
      await db.delete(notificationLog).where(isNull(notificationLog.tenantId))
      await db.delete(tenants).where(eq(tenants.id, fx.tenantA!))
      await db.delete(tenants).where(eq(tenants.id, fx.tenantB!))
      await db.delete(users).where(eq(users.id, fx.userA!))
      await db.delete(users).where(eq(users.id, fx.userB!))
    })
  })

  it('tenant A sees ONLY its own notification_log rows', async () => {
    const rows = await withTenant(fx.tenantA!, async (db) => db.select().from(notificationLog))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.tenantId).toBe(fx.tenantA)
    expect(rows[0]!.providerMessageId).toBe('ses-a')
  })

  it('tenant A cannot see tenant B rows (zero for B id)', async () => {
    const rows = await withTenant(fx.tenantA!, async (db) =>
      db.select().from(notificationLog).where(eq(notificationLog.tenantId, fx.tenantB!)),
    )
    expect(rows).toHaveLength(0)
  })

  it('tenant A cannot see NULL-tenant system rows', async () => {
    const rows = await withTenant(fx.tenantA!, async (db) =>
      db.select().from(notificationLog).where(isNull(notificationLog.tenantId)),
    )
    expect(rows).toHaveLength(0)
  })

  it('super-admin bypasses RLS and sees all three seeded rows', async () => {
    const rows = await withSuperAdmin(async (db) => db.select().from(notificationLog))
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })
})

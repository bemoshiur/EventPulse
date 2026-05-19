import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'

import { resetPool, withSuperAdmin } from '../client.js'
import { tenants, users } from '../schema/index.js'

/**
 * Migration 0009 — tenants.preferred_locale column tests (Decision O.2).
 *
 * Two test bodies:
 *   1. Default 'bn' applies on INSERT when preferred_locale is omitted.
 *   2. CHECK constraint rejects unknown locales (e.g. 'es') with the
 *      Postgres 23514 check_violation error.
 *
 * Skipped automatically when DATABASE_URL is unset (matches the pattern
 * in rls-cross-tenant.test.ts). CI's `integration-tests` job applies
 * migration 0009 before this test runs.
 *
 * Fixtures are cleaned up in afterAll so re-running the test suite
 * doesn't accumulate orphan rows.
 */

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('migration 0009 — tenants.preferred_locale', () => {
  const fixtures: { ownerId?: string; tenantId?: string } = {}

  beforeAll(async () => {
    await withSuperAdmin(async (db) => {
      const [owner] = await db
        .insert(users)
        .values({
          email: `loc-owner-${Date.now()}@test.local`,
          fullName: 'Locale Test Owner',
        })
        .returning({ id: users.id })
      fixtures.ownerId = owner!.id
    })
  })

  afterAll(async () => {
    if (fixtures.tenantId) {
      await withSuperAdmin(async (db) => {
        await db.delete(tenants).where(eq(tenants.id, fixtures.tenantId!))
      })
    }
    if (fixtures.ownerId) {
      await withSuperAdmin(async (db) => {
        await db.delete(users).where(eq(users.id, fixtures.ownerId!))
      })
    }
    await resetPool()
  })

  it("defaults preferred_locale to 'bn' when omitted on INSERT", async () => {
    await withSuperAdmin(async (db) => {
      const [row] = await db
        .insert(tenants)
        .values({
          name: 'Locale Default Test',
          slug: `loc-default-${Date.now()}`,
          isPersonal: true,
          ownerUserId: fixtures.ownerId!,
        })
        .returning({ id: tenants.id, preferredLocale: tenants.preferredLocale })

      expect(row!.preferredLocale).toBe('bn')
      fixtures.tenantId = row!.id
    })
  })

  it('rejects unknown locale values via tenants_preferred_locale_chk (23514)', async () => {
    // Use raw SQL to bypass Drizzle's TypeScript narrowing on the column
    // type — the runtime check on the DB layer is what we want to assert,
    // not the static type guard. Drizzle would also reject 'es' at the
    // TS level but that's a different layer of defence.
    await withSuperAdmin(async (db) => {
      const slug = `loc-bad-${Date.now()}`
      let caughtCode: string | undefined
      let caughtMessage: string | undefined
      try {
        await db.execute(sql`
          INSERT INTO tenants (name, slug, is_personal, owner_user_id, preferred_locale)
          VALUES (${'Bad Locale Test'}, ${slug}, true, ${fixtures.ownerId!}, ${'es'})
        `)
      } catch (err) {
        // pg.DatabaseError → code='23514', constraint='tenants_preferred_locale_chk'.
        // Drizzle wraps PG errors in DrizzleQueryError; the underlying pg
        // error is on .cause per Drizzle conventions.
        const e = err as { code?: string; message?: string; cause?: unknown }
        const cause = e.cause as { code?: string; message?: string } | undefined
        caughtCode = e.code ?? cause?.code
        caughtMessage = e.message ?? cause?.message
      }
      expect(caughtCode, 'expected pg error code 23514 (check_violation)').toBe('23514')
      expect(caughtMessage).toMatch(/tenants_preferred_locale_chk/)
    })
  })

  it("accepts 'en' explicitly", async () => {
    await withSuperAdmin(async (db) => {
      const slug = `loc-en-${Date.now()}`
      const [row] = await db
        .insert(tenants)
        .values({
          name: 'EN Locale Test',
          slug,
          isPersonal: true,
          ownerUserId: fixtures.ownerId!,
          preferredLocale: 'en',
        })
        .returning({ id: tenants.id, preferredLocale: tenants.preferredLocale })
      expect(row!.preferredLocale).toBe('en')
      // Clean up immediately so afterAll's single fixture row is the only leftover.
      await db.delete(tenants).where(eq(tenants.id, row!.id))
    })
  })
})

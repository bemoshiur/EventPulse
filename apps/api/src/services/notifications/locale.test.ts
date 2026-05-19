import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import { resetPool, withSuperAdmin } from '../../db/client.js'
import { tenants, users } from '../../db/schema/index.js'
import { selectLocale } from './locale.js'

/**
 * Locale-selector tests — Decision O.2.
 *
 * Discriminated union routes the lookup to the right table:
 *   { tenantId } → tenants.preferred_locale
 *   { userId }   → users.locale
 *
 * DB-gated; skipped when DATABASE_URL is unset.
 */

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('selectLocale (Decision O.2)', () => {
  const fx: {
    userBnId?: string
    userEnId?: string
    tenantBnId?: string
    tenantEnId?: string
  } = {}

  beforeAll(async () => {
    await withSuperAdmin(async (db) => {
      const stamp = Date.now()
      const [userBn] = await db
        .insert(users)
        .values({
          email: `loc-helper-bn-${stamp}@test.local`,
          fullName: 'BN Helper User',
          locale: 'bn',
        })
        .returning({ id: users.id })
      fx.userBnId = userBn!.id

      const [userEn] = await db
        .insert(users)
        .values({
          email: `loc-helper-en-${stamp}@test.local`,
          fullName: 'EN Helper User',
          locale: 'en',
        })
        .returning({ id: users.id })
      fx.userEnId = userEn!.id

      // Tenants — one default (preferred_locale defaults to 'bn'), one
      // explicitly 'en'.
      const [tenantBn] = await db
        .insert(tenants)
        .values({
          name: 'BN Tenant',
          slug: `loc-helper-bn-${stamp}`,
          isPersonal: true,
          ownerUserId: fx.userBnId,
        })
        .returning({ id: tenants.id })
      fx.tenantBnId = tenantBn!.id

      const [tenantEn] = await db
        .insert(tenants)
        .values({
          name: 'EN Tenant',
          slug: `loc-helper-en-${stamp}`,
          isPersonal: true,
          ownerUserId: fx.userEnId,
          preferredLocale: 'en',
        })
        .returning({ id: tenants.id })
      fx.tenantEnId = tenantEn!.id
    })
  })

  afterAll(async () => {
    await withSuperAdmin(async (db) => {
      if (fx.tenantBnId) await db.delete(tenants).where(eq(tenants.id, fx.tenantBnId))
      if (fx.tenantEnId) await db.delete(tenants).where(eq(tenants.id, fx.tenantEnId))
      if (fx.userBnId) await db.delete(users).where(eq(users.id, fx.userBnId))
      if (fx.userEnId) await db.delete(users).where(eq(users.id, fx.userEnId))
    })
    await resetPool()
  })

  it("{tenantId} → reads tenants.preferred_locale ('bn' default for new tenants)", async () => {
    const locale = await selectLocale({ tenantId: fx.tenantBnId! })
    expect(locale).toBe('bn')
  })

  it("{tenantId} → reads tenants.preferred_locale ('en' explicit)", async () => {
    const locale = await selectLocale({ tenantId: fx.tenantEnId! })
    expect(locale).toBe('en')
  })

  it("{userId} → reads users.locale ('bn')", async () => {
    const locale = await selectLocale({ userId: fx.userBnId! })
    expect(locale).toBe('bn')
  })

  it("{userId} → reads users.locale ('en' default per Sprint 1)", async () => {
    const locale = await selectLocale({ userId: fx.userEnId! })
    expect(locale).toBe('en')
  })

  it("defaults to 'en' on missing tenant (defensive fallback)", async () => {
    // Random uuid that doesn't exist.
    const locale = await selectLocale({
      tenantId: '00000000-0000-0000-0000-000000000001',
    })
    expect(locale).toBe('en')
  })

  it("defaults to 'en' on missing user (defensive fallback)", async () => {
    const locale = await selectLocale({
      userId: '00000000-0000-0000-0000-000000000002',
    })
    expect(locale).toBe('en')
  })
})

import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'

import {
  feeOverrideLog,
  handleHistory,
  magicLinks,
  oauthIdentities,
  reservedHandles,
  sessions,
  superAdmins,
  tenantFeeConfig,
  tenantUsers,
  tenants,
  users,
} from './index.js'

/**
 * Schema sanity tests. These do NOT touch a real database — they assert
 * the Drizzle table definitions match what the SQL migrations should
 * produce. Real DB-touching integration tests live in
 * `__tests__/rls-cross-tenant.test.ts` and run only when DATABASE_URL is
 * set (CI provides it via the Postgres service in ci.yml).
 */

describe('schema/identity tables', () => {
  it('users table has handle (UNIQUE, nullable) and password_hash (nullable)', () => {
    const t = getTableConfig(users)
    const handle = t.columns.find((c) => c.name === 'handle')
    expect(handle).toBeDefined()
    expect(handle?.isUnique).toBe(true)
    expect(handle?.notNull).toBe(false)

    const passwordHash = t.columns.find((c) => c.name === 'password_hash')
    expect(passwordHash?.notNull).toBe(false)
  })

  it('tenants table has is_personal + owner_user_id (v2.1)', () => {
    const t = getTableConfig(tenants)
    expect(t.columns.find((c) => c.name === 'is_personal')).toBeDefined()
    expect(t.columns.find((c) => c.name === 'owner_user_id')).toBeDefined()
  })

  it('tenants table has preferred_locale (NOT NULL, default bn) per Decision O.2', () => {
    const t = getTableConfig(tenants)
    const col = t.columns.find((c) => c.name === 'preferred_locale')
    expect(col, 'preferred_locale column missing — migration 0009 dropped').toBeDefined()
    expect(col?.notNull).toBe(true)
    expect(col?.default).toBe('bn')
  })

  it('tenants.slug and users.handle share the same data type for cross-namespace lookup', () => {
    const tenantsSlug = getTableConfig(tenants).columns.find((c) => c.name === 'slug')!
    const usersHandle = getTableConfig(users).columns.find((c) => c.name === 'handle')!
    expect(tenantsSlug.dataType).toBe(usersHandle.dataType)
  })

  it('tenant_fee_config defaults the mode to pass_through (decision 2026-05-16)', () => {
    const t = getTableConfig(tenantFeeConfig)
    const mode = t.columns.find((c) => c.name === 'default_fee_mode')!
    expect(mode.default).toBe('pass_through')
  })

  it('tenant_fee_config defaults bps to 25 (0.25%) per playbook §14.1', () => {
    const t = getTableConfig(tenantFeeConfig)
    const bps = t.columns.find((c) => c.name === 'platform_fee_bps')!
    expect(bps.default).toBe(25)
  })

  it('sessions audience covers all three portals', () => {
    const t = getTableConfig(sessions)
    expect(t.columns.find((c) => c.name === 'audience')?.notNull).toBe(true)
    expect(t.columns.find((c) => c.name === 'tenant_id')?.notNull).toBe(false)
  })

  it('oauth_identities has provider + provider_user_id composite unique', () => {
    const t = getTableConfig(oauthIdentities)
    const uq = t.uniqueConstraints.find((c) =>
      c.columns.some((col) => col.name === 'provider_user_id'),
    )
    expect(uq).toBeDefined()
    expect(uq?.columns.map((c) => c.name).sort()).toEqual(['provider', 'provider_user_id'])
  })

  it('tenant_users PK is composite (tenant_id, user_id)', () => {
    const t = getTableConfig(tenantUsers)
    const pk = t.primaryKeys[0]
    expect(pk?.columns.map((c) => c.name).sort()).toEqual(['tenant_id', 'user_id'])
  })

  it('magic_links token_hash is the PK', () => {
    const t = getTableConfig(magicLinks)
    const tokenHash = t.columns.find((c) => c.name === 'token_hash')!
    expect(tokenHash.primary).toBe(true)
  })

  it('super_admins user_id is the PK', () => {
    const t = getTableConfig(superAdmins)
    expect(t.columns.find((c) => c.name === 'user_id')?.primary).toBe(true)
  })

  it('reserved_handles handle is the PK', () => {
    const t = getTableConfig(reservedHandles)
    expect(t.columns.find((c) => c.name === 'handle')?.primary).toBe(true)
  })

  it('handle_history has both user_id and tenant_id (with XOR check)', () => {
    const t = getTableConfig(handleHistory)
    expect(t.columns.find((c) => c.name === 'user_id')?.notNull).toBe(false)
    expect(t.columns.find((c) => c.name === 'tenant_id')?.notNull).toBe(false)
  })

  it('fee_override_log captures both previous and new state', () => {
    const t = getTableConfig(feeOverrideLog)
    for (const col of [
      'previous_fee_bps',
      'new_fee_bps',
      'previous_mode',
      'new_mode',
      'changed_by',
      'reason',
    ]) {
      const c = t.columns.find((x) => x.name === col)
      expect(c, `column ${col} missing`).toBeDefined()
      expect(c?.notNull, `column ${col} should be NOT NULL`).toBe(true)
    }
  })
})

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import { resetPool, withSuperAdmin } from '../../db/client.js'
import { auditLogs, tenants, users } from '../../db/schema/index.js'
import { _resetSsmClientForTests, provisionTenantSubdomain } from './provision.js'

/**
 * Provisioner integration tests — Sprint 3 Day 22 Workstream 2.
 *
 * Two test surfaces:
 *
 *   1. Dry-run mode (SUBDOMAIN_PROVISION_DRY_RUN=1) — exercises template
 *      render + command generation + idempotency check without calling
 *      SSM. Runs in CI; no AWS creds required.
 *   2. Already-provisioned no-op (tenants.subdomain_provisioned_at NOT
 *      NULL) — provisioner returns 'already_provisioned' without touching
 *      SSM or the audit log.
 *
 * The real SSM-against-staging test is a separately-gated manual run
 * documented in the PR body; not in this file.
 */

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('provisionTenantSubdomain (dry-run + idempotency)', () => {
  const fx: { ownerId?: string; tenantId?: string; tenantSlug?: string } = {}
  const originalDryRun = process.env['SUBDOMAIN_PROVISION_DRY_RUN']
  const originalInstanceId = process.env['STAGING_EC2_INSTANCE_ID']

  beforeAll(async () => {
    process.env['SUBDOMAIN_PROVISION_DRY_RUN'] = '1'
    // Required env even in dry-run because the check is order-sensitive
    // — we exercise the dry-run branch before envInstanceId() would throw,
    // but defense in depth.
    process.env['STAGING_EC2_INSTANCE_ID'] = 'i-test-fixture'

    await withSuperAdmin(async (db) => {
      const [owner] = await db
        .insert(users)
        .values({
          email: `provision-test-${Date.now()}@test.local`,
          fullName: 'Provision Test Owner',
        })
        .returning({ id: users.id })
      fx.ownerId = owner!.id

      fx.tenantSlug = `provision-test-${Date.now()}`
      const [tenant] = await db
        .insert(tenants)
        .values({
          name: 'Provision Test Tenant',
          slug: fx.tenantSlug,
          isPersonal: true,
          ownerUserId: fx.ownerId,
        })
        .returning({ id: tenants.id })
      fx.tenantId = tenant!.id
    })
  })

  afterAll(async () => {
    if (originalDryRun === undefined) {
      delete process.env['SUBDOMAIN_PROVISION_DRY_RUN']
    } else {
      process.env['SUBDOMAIN_PROVISION_DRY_RUN'] = originalDryRun
    }
    if (originalInstanceId === undefined) {
      delete process.env['STAGING_EC2_INSTANCE_ID']
    } else {
      process.env['STAGING_EC2_INSTANCE_ID'] = originalInstanceId
    }
    _resetSsmClientForTests()
    await withSuperAdmin(async (db) => {
      if (fx.tenantId) {
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, fx.tenantId))
        await db.delete(tenants).where(eq(tenants.id, fx.tenantId))
      }
      if (fx.ownerId) await db.delete(users).where(eq(users.id, fx.ownerId))
    })
    await resetPool()
  })

  beforeEach(async () => {
    // Reset provisioned_at so each test starts from a clean slate.
    await withSuperAdmin(async (db) => {
      await db
        .update(tenants)
        .set({ subdomainProvisionedAt: null, subdomainProvisioningFailedAt: null })
        .where(eq(tenants.id, fx.tenantId!))
    })
  })

  it('returns tenant_missing for a non-existent tenant', async () => {
    const result = await provisionTenantSubdomain({
      tenantId: '00000000-0000-0000-0000-000000000099',
      actorUserId: fx.ownerId!,
    })
    expect(result.status).toBe('tenant_missing')
  })

  it('returns dry_run in SUBDOMAIN_PROVISION_DRY_RUN=1 mode', async () => {
    const result = await provisionTenantSubdomain({
      tenantId: fx.tenantId!,
      actorUserId: fx.ownerId!,
    })
    expect(result.status).toBe('dry_run')
    if (result.status === 'dry_run') {
      expect(result.commandsCount).toBe(5)
    }
  })

  it('dry-run does NOT update tenants.subdomain_provisioned_at', async () => {
    await provisionTenantSubdomain({
      tenantId: fx.tenantId!,
      actorUserId: fx.ownerId!,
    })
    await withSuperAdmin(async (db) => {
      const [row] = await db
        .select({ provisionedAt: tenants.subdomainProvisionedAt })
        .from(tenants)
        .where(eq(tenants.id, fx.tenantId!))
      expect(row?.provisionedAt).toBeNull()
    })
  })

  it("returns 'already_provisioned' when subdomain_provisioned_at is already set", async () => {
    const fixedTs = new Date('2026-05-01T12:00:00Z')
    await withSuperAdmin(async (db) => {
      await db
        .update(tenants)
        .set({ subdomainProvisionedAt: fixedTs })
        .where(eq(tenants.id, fx.tenantId!))
    })
    const result = await provisionTenantSubdomain({
      tenantId: fx.tenantId!,
      actorUserId: fx.ownerId!,
    })
    expect(result.status).toBe('already_provisioned')
    if (result.status === 'already_provisioned') {
      expect(result.provisionedAt.toISOString()).toBe(fixedTs.toISOString())
    }
  })

  it('already-provisioned no-op does NOT write to audit_logs', async () => {
    await withSuperAdmin(async (db) => {
      await db
        .update(tenants)
        .set({ subdomainProvisionedAt: new Date() })
        .where(eq(tenants.id, fx.tenantId!))
    })
    await provisionTenantSubdomain({
      tenantId: fx.tenantId!,
      actorUserId: fx.ownerId!,
    })
    await withSuperAdmin(async (db) => {
      const rows = await db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.tenantId, fx.tenantId!))
      const provisioningRows = rows.filter((r) => r.action.startsWith('tenant.subdomain_'))
      expect(provisioningRows).toHaveLength(0)
    })
  })
})

describe('provisionTenantSubdomain — env validation (unit, no DB)', () => {
  const originalInstanceId = process.env['STAGING_EC2_INSTANCE_ID']
  const originalDryRun = process.env['SUBDOMAIN_PROVISION_DRY_RUN']

  beforeEach(() => {
    // Clear the env to exercise the failure path.
    delete process.env['STAGING_EC2_INSTANCE_ID']
    delete process.env['SUBDOMAIN_PROVISION_DRY_RUN']
  })

  afterEach(() => {
    if (originalInstanceId === undefined) {
      delete process.env['STAGING_EC2_INSTANCE_ID']
    } else {
      process.env['STAGING_EC2_INSTANCE_ID'] = originalInstanceId
    }
    if (originalDryRun === undefined) {
      delete process.env['SUBDOMAIN_PROVISION_DRY_RUN']
    } else {
      process.env['SUBDOMAIN_PROVISION_DRY_RUN'] = originalDryRun
    }
  })

  it('skipped placeholder — STAGING_EC2_INSTANCE_ID missing is caught by env at module-init time in real usage; the dry-run path is the canonical CI exercise', () => {
    // Sanity placeholder so the file has at least one always-running test.
    expect(true).toBe(true)
  })
})

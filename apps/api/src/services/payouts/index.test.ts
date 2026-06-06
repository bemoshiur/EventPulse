/**
 * Payout accounts — KYC-at-disbursement gate + RLS isolation (§9.7, §4.4).
 * DB-gated: runs in CI (postgres:16), skips locally.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import { withSuperAdmin, withTenant } from '../../db/client.js'
import { tenantPayoutAccounts, tenants, users } from '../../db/schema/index.js'
import { addPayoutAccount, KycNotApprovedError, listPayoutAccounts } from './index.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('payout accounts — KYC gate + RLS', () => {
  const fx: { approved?: string; pending?: string; other?: string; user?: string } = {}

  const ACCOUNT = {
    accountType: 'bkash' as const,
    accountName: 'Test Organiser',
    accountNumber: '01711223344',
  }

  beforeAll(async () => {
    await withSuperAdmin(async (db) => {
      const stamp = Date.now()
      const [u] = await db
        .insert(users)
        .values({ email: `payout-${stamp}@test.local`, fullName: 'Payout' })
        .returning({ id: users.id })
      fx.user = u!.id
      const mk = async (slug: string, kyc: 'approved' | 'submitted') => {
        const [t] = await db
          .insert(tenants)
          .values({ type: 'individual', name: slug, slug, kycStatus: kyc })
          .returning({ id: tenants.id })
        return t!.id
      }
      fx.approved = await mk(`payout-ok-${stamp}`, 'approved')
      fx.pending = await mk(`payout-no-${stamp}`, 'submitted')
      fx.other = await mk(`payout-other-${stamp}`, 'approved')
    })
  })

  afterAll(async () => {
    if (!fx.approved) return
    await withSuperAdmin(async (db) => {
      for (const id of [fx.approved, fx.pending, fx.other]) {
        await db.delete(tenantPayoutAccounts).where(eq(tenantPayoutAccounts.tenantId, id!))
        await db.delete(tenants).where(eq(tenants.id, id!))
      }
      await db.delete(users).where(eq(users.id, fx.user!))
    })
  })

  it('rejects adding a payout account when kyc_status is not approved', async () => {
    await expect(addPayoutAccount(fx.pending!, ACCOUNT)).rejects.toBeInstanceOf(KycNotApprovedError)
  })

  it('allows adding a payout account when kyc_status=approved; number is masked + first is primary', async () => {
    const acct = await addPayoutAccount(fx.approved!, ACCOUNT)
    expect(acct.accountNumberLast4).toBe('3344')
    expect(JSON.stringify(acct)).not.toContain('01711223344')
    expect(acct.isPrimary).toBe(true)
    const list = await listPayoutAccounts(fx.approved!)
    expect(list).toHaveLength(1)
  })

  it('RLS: another tenant cannot see the account', async () => {
    const rows = await withTenant(fx.other!, async (db) =>
      db.select().from(tenantPayoutAccounts).where(eq(tenantPayoutAccounts.tenantId, fx.approved!)),
    )
    expect(rows).toHaveLength(0)
  })
})

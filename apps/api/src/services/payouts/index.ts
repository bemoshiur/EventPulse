/**
 * Tenant payout accounts — the disbursement entry point (§9.7).
 *
 * KYC-at-disbursement (decisions.md 2026-06-06): a tenant may publish free AND
 * paid events without KYC, but CANNOT add a payout account (i.e. cannot set up
 * to receive money) until `tenants.kyc_status = 'approved'`. `addPayoutAccount`
 * enforces that gate inside the same withTenant transaction that inserts the row.
 */

import { eq } from 'drizzle-orm'

import { withTenant } from '../../db/client.js'
import { tenantPayoutAccounts, tenants } from '../../db/schema/index.js'

export class KycNotApprovedError extends Error {
  constructor(public readonly kycStatus: string) {
    super('KYC approval is required before adding a payout account')
    this.name = 'KycNotApprovedError'
  }
}

export interface PayoutAccountInput {
  accountType: 'bank' | 'bkash' | 'nagad' | 'rocket' | 'upay'
  accountName: string
  accountNumber: string
  bankName?: string | null
  branchName?: string | null
  routingNumber?: string | null
  isPrimary?: boolean
}

export interface PayoutAccountRecord {
  id: string
  accountType: string
  accountName: string
  accountNumberLast4: string
  bankName: string | null
  branchName: string | null
  isPrimary: boolean
  verifiedAt: string | null
  createdAt: string
}

function toRecord(row: typeof tenantPayoutAccounts.$inferSelect): PayoutAccountRecord {
  return {
    id: row.id,
    accountType: row.accountType,
    accountName: row.accountName,
    // Never echo the full account number back to the client.
    accountNumberLast4: row.accountNumber.slice(-4),
    bankName: row.bankName,
    branchName: row.branchName,
    isPrimary: row.isPrimary,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listPayoutAccounts(tenantId: string): Promise<PayoutAccountRecord[]> {
  return withTenant(tenantId, async (db) => {
    const rows = await db
      .select()
      .from(tenantPayoutAccounts)
      .where(eq(tenantPayoutAccounts.tenantId, tenantId))
    return rows.map(toRecord)
  })
}

export async function addPayoutAccount(
  tenantId: string,
  input: PayoutAccountInput,
): Promise<PayoutAccountRecord> {
  return withTenant(tenantId, async (db) => {
    // KYC gate — read the tenant's own row (RLS-permitted) and require approval.
    const [t] = await db
      .select({ kycStatus: tenants.kycStatus })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    if (!t || t.kycStatus !== 'approved') {
      throw new KycNotApprovedError(t?.kycStatus ?? 'unknown')
    }

    // First account becomes primary by default.
    const existing = await db
      .select({ id: tenantPayoutAccounts.id })
      .from(tenantPayoutAccounts)
      .where(eq(tenantPayoutAccounts.tenantId, tenantId))
    const isPrimary = input.isPrimary ?? existing.length === 0

    const [row] = await db
      .insert(tenantPayoutAccounts)
      .values({
        tenantId,
        accountType: input.accountType,
        accountName: input.accountName,
        accountNumber: input.accountNumber,
        bankName: input.bankName ?? null,
        branchName: input.branchName ?? null,
        routingNumber: input.routingNumber ?? null,
        isPrimary,
      })
      .returning()
    return toRecord(row!)
  })
}

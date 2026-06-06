/**
 * Tenant payout-account routes — tenant context. Mounted at
 * /api/v1/tenant/payout-accounts.
 *
 *   GET  /            — list the tenant's payout accounts (number masked)
 *   POST /            — add a payout account; GATED on KYC approval
 *                       (403 KYC_NOT_APPROVED until tenants.kyc_status='approved')
 *
 * This is the KYC-at-disbursement enforcement point (decisions.md 2026-06-06):
 * a tenant sells freely but must be verified before setting up to receive money.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireTenantAuth } from '../../auth/middleware.js'
import { requireTenantType } from '../../auth/tenant-type-gate.js'
import { logger } from '../../lib/logger.js'
import {
  addPayoutAccount,
  KycNotApprovedError,
  listPayoutAccounts,
} from '../../services/payouts/index.js'

const app = new Hono()
app.use('*', requireTenantAuth)
app.use('*', requireTenantType)

const createSchema = z.object({
  accountType: z.enum(['bank', 'bkash', 'nagad', 'rocket', 'upay']),
  accountName: z.string().min(2).max(120),
  accountNumber: z.string().min(4).max(40),
  bankName: z.string().max(120).optional(),
  branchName: z.string().max(120).optional(),
  routingNumber: z.string().max(40).optional(),
})

app.get('/', async (c) => {
  const tenantId = c.get('tenantId') as string
  const accounts = await listPayoutAccounts(tenantId)
  return c.json({ data: accounts })
})

app.post('/', zValidator('json', createSchema), async (c) => {
  const tenantId = c.get('tenantId') as string
  const input = c.req.valid('json')
  try {
    const account = await addPayoutAccount(tenantId, input)
    return c.json({ data: account }, 201)
  } catch (err) {
    if (err instanceof KycNotApprovedError) {
      return c.json(
        {
          error: {
            code: 'KYC_NOT_APPROVED',
            message: 'Verify your identity (KYC) before adding a payout account.',
            details: [{ field: 'kyc_status', message: err.kycStatus }],
          },
        },
        403,
      )
    }
    logger.error({ err, tenantId }, 'tenant.payout_accounts.create_failed')
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'failed to add account' } }, 500)
  }
})

export const tenantPayoutAccountRoutes = app

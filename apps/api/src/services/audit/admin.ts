/**
 * Audit helpers for super-admin domain — Day 44.
 *
 * Sibling to apps/api/src/services/audit/{orders,events,kyc,legal,...}.ts.
 * One-per-domain audit-helper convention per decisions.md 2026-05-17.
 *
 * Today (Day 44):
 *   • writeDisbursementCsvExported — bulk financial extraction audit.
 *     One row per CSV export from the super-admin disbursement-export
 *     endpoint. Captures who exported, what window, how many tenants,
 *     total net paisa. NOT per-tenant-row — matches Day-32 attendee
 *     export Decision A (one audit row per discrete operational event).
 *
 * Future helpers belong here as the super-admin surface area grows.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { auditLogs } from '../../db/schema/index.js'

type Tx = NodePgDatabase<Record<string, unknown>>

// ─── writeDisbursementCsvExported ───────────────────────────────────

export interface WriteDisbursementCsvExportedInput {
  /** Super-admin actor user id. */
  actorUserId: string
  /** Inclusive lower bound on orders.paid_at. */
  periodStart: Date
  /** Exclusive upper bound on orders.paid_at. */
  periodEnd: Date
  /** Optional single-tenant filter applied. */
  tenantId: string | null
  /** Number of tenant rows in the CSV. */
  rowCount: number
  /** Sum of net_paisa across all CSV rows (the actual disbursement total). */
  totalNetPaisa: bigint
  ip: string | null
  userAgent: string | null
}

/**
 * Audit row for the disbursement CSV export. tenant_id is NULL because
 * the action is cross-tenant by design (super-admin viewing platform-
 * wide disbursement obligations); the filter snapshot captures whether
 * a single-tenant filter was applied. entity_type='platform' (a global
 * action, not scoped to a specific row).
 */
export async function writeDisbursementCsvExported(
  tx: Tx,
  input: WriteDisbursementCsvExportedInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: null,
    actorType: 'super_admin',
    actorId: input.actorUserId,
    action: 'disbursements.exported_csv',
    entityType: 'platform',
    entityId: null,
    diff: {
      period_start: input.periodStart.toISOString(),
      period_end: input.periodEnd.toISOString(),
      tenant_id_filter: input.tenantId,
      row_count: input.rowCount,
      total_net_paisa: input.totalNetPaisa.toString(),
    },
    ip: input.ip,
    userAgent: input.userAgent,
  })
}

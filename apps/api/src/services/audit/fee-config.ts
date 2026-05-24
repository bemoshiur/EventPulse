/**
 * Audit helpers for tenant fee-config mutations — Sprint 3 Day 23
 * Workstream 2.
 *
 * Sibling to apps/api/src/services/audit/{kyc,tenant,events,tenant-
 * subdomain}.ts. Per the one-per-domain rule (decisions.md 2026-05-17
 * reaffirmed 2026-05-18): one helper per domain-action; multiple sibling
 * helpers in the same domain file are fine.
 *
 * What ships today:
 *
 *   • writeFeeOverrideSet — audit row written alongside the
 *     fee_override_log insert + tenant_fee_config update. The
 *     fee_override_log table itself IS the primary audit surface
 *     for fee changes per §9.12; this audit_logs row is the
 *     unified per-tenant action stream (tenant.fee_overridden as
 *     the action verb). Both rows commit in the same tx so a fee
 *     change without its audit, or vice-versa, is impossible.
 *
 * Why double-bookkeeping (fee_override_log + audit_logs):
 *
 *   - fee_override_log is the fee-specific audit shape: prev_bps,
 *     new_bps, prev_mode, new_mode, reason, effective_from, changed_by.
 *     Fee-domain queries (e.g. "show me every fee change for tenant X
 *     in date range") run against this table for shape + index locality.
 *   - audit_logs is the cross-domain action stream: tenant lifecycle
 *     queries (e.g. "show me everything that happened to tenant X today
 *     across KYC, fees, subdomain, etc.") run against this table. The
 *     fee row here references entity_type='tenant', entity_id=tenant.id,
 *     with diff carrying a compact summary that points at the
 *     fee_override_log row for the detailed shape.
 *
 * Actor role: always 'super_admin' — only super admins can change
 * platform fees per §14.4 + §10.4 (admin/tenants/:id/fee-override).
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { auditLogs } from '../../db/schema/index.js'
import type { FeeHandlingMode } from '@eventpulse/shared-types'

export type FeeConfigAuditActorRole = 'super_admin'

export interface WriteFeeOverrideSetInput {
  tenantId: string
  actorUserId: string
  actorRole: FeeConfigAuditActorRole
  previousFeeBps: number
  newFeeBps: number
  previousMode: FeeHandlingMode
  newMode: FeeHandlingMode
  reason: string
  effectiveFrom: Date
  /** UUID of the fee_override_log row written in the same tx — lets
   *  audit-log queries traverse directly to the fee-specific shape
   *  without a join on (tenant_id, changed_at). */
  feeOverrideLogId: string
  /** True when the change exceeds ±10 bps in either direction —
   *  drives the 4-eyes alert per §14.4. The audit row captures the
   *  flag so a forensic query can filter on it without re-deriving. */
  isAnomalous: boolean
  ip?: string | null
  userAgent?: string | null
}

type Tx = NodePgDatabase<Record<string, unknown>>

export async function writeFeeOverrideSet(tx: Tx, input: WriteFeeOverrideSetInput): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: input.actorRole,
    actorId: input.actorUserId,
    action: 'tenant.fee_overridden',
    entityType: 'tenant',
    entityId: input.tenantId,
    diff: {
      fee_bps: { from: input.previousFeeBps, to: input.newFeeBps },
      mode: { from: input.previousMode, to: input.newMode },
      reason: input.reason,
      effective_from: input.effectiveFrom.toISOString(),
    },
    metadata: {
      actor_role: input.actorRole,
      fee_override_log_id: input.feeOverrideLogId,
      is_anomalous: input.isAnomalous,
    },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}

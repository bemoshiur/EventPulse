/**
 * Tenant fee-config service layer — Sprint 3 Day 23 Workstream 2.
 *
 * Per CLAUDE.md §14.4 + §10.4 + §9.12, fee overrides are managed by
 * super admins only. No tenant-portal write surface. The tenant sees
 * their current fee in their portal (Settings → Fees & Payouts) via
 * the same getEffectiveFees read used at order creation, but they
 * cannot change it.
 *
 * Per decisions.md 2026-05-24 ("EPS fee is NOT per-tenant
 * configurable"): only platform_fee_bps + default_fee_mode live in
 * tenant_fee_config. EPS fee is pass-through from payment-method
 * metadata at order time. This service NEVER reads/writes any
 * EPS-fee config — it doesn't exist.
 *
 * Four functions:
 *
 *   • getEffectiveFees(tenantId)   — single source of truth for
 *                                     "what platform_fee_bps does this
 *                                     tenant pay right now?". Order
 *                                     creation Day 24+ MUST call this
 *                                     instead of querying tenant_fee_
 *                                     config directly so the fallback-
 *                                     to-default path is consistent.
 *   • setOverride({...})            — atomic INSERT fee_override_log +
 *                                     UPSERT tenant_fee_config + audit
 *                                     row inside one tx. Computes the
 *                                     is_anomalous flag (>10 bps swing)
 *                                     and surfaces it in the audit
 *                                     metadata for the 4-eyes alert.
 *   • clearOverride(tenantId, ...)  — reset to platform default
 *                                     (25 bps + 'pass_through') with a
 *                                     fee_override_log entry + audit
 *                                     row capturing the reset.
 *   • getHistory(tenantId, limit?)  — paginated fee_override_log read,
 *                                     newest first.
 *
 * Anomaly threshold per §14.4: any change of more than 10 bps in
 * either direction. >10 bps absolute = anomalous. Equal-or-less-than-
 * 10 bps = routine. The threshold is exposed as a constant so callers
 * (e.g. Phase 2 Slack-alert worker) can re-use the same boundary.
 */

import { desc, eq } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { feeOverrideLog, tenantFeeConfig } from '../../db/schema/index.js'
import type { FeeHandlingMode } from '@eventpulse/shared-types'
import { logger } from '../../lib/logger.js'
import { writeFeeOverrideSet } from '../audit/fee-config.js'

/** Platform defaults per §14.1: 25 bps + pass_through. Single source
 *  of truth — change here, change everywhere. */
export const PLATFORM_DEFAULT_FEE_BPS = 25
export const PLATFORM_DEFAULT_FEE_MODE: FeeHandlingMode = 'pass_through'

/** Per §14.4: 4-eyes notification fires on changes exceeding ±10 bps. */
export const ANOMALOUS_FEE_DELTA_BPS = 10

// ─── typed errors ─────────────────────────────────────────────────────

export class FeeConfigInvalidBpsError extends Error {
  constructor(public readonly bps: number) {
    super(`platform_fee_bps must be 0..10000 (got ${bps})`)
    this.name = 'FeeConfigInvalidBpsError'
  }
}

export class FeeConfigReasonMissingError extends Error {
  constructor() {
    super('reason is required for fee override changes (§14.4 audit trail)')
    this.name = 'FeeConfigReasonMissingError'
  }
}

// ─── getEffectiveFees ─────────────────────────────────────────────────

export interface EffectiveFees {
  /** Current platform fee in basis points (25 = 0.25%). */
  platformFeeBps: number
  /** Current default fee mode (applies to new events when caller omits). */
  defaultFeeMode: FeeHandlingMode
  /** True when this tenant has an explicit row in tenant_fee_config;
   *  false when reading platform defaults via the fallback path. */
  hasOverride: boolean
  /** Last-mutation timestamp from tenant_fee_config.effective_from;
   *  null when hasOverride is false. */
  effectiveFrom: Date | null
  /** Optional super-admin annotation captured at setOverride time. */
  customArrangementNote: string | null
}

export async function getEffectiveFees(tenantId: string): Promise<EffectiveFees> {
  return withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        platformFeeBps: tenantFeeConfig.platformFeeBps,
        defaultFeeMode: tenantFeeConfig.defaultFeeMode,
        effectiveFrom: tenantFeeConfig.effectiveFrom,
        customArrangementNote: tenantFeeConfig.customArrangementNote,
      })
      .from(tenantFeeConfig)
      .where(eq(tenantFeeConfig.tenantId, tenantId))
      .limit(1)
    const row = rows[0]
    if (!row) {
      return {
        platformFeeBps: PLATFORM_DEFAULT_FEE_BPS,
        defaultFeeMode: PLATFORM_DEFAULT_FEE_MODE,
        hasOverride: false,
        effectiveFrom: null,
        customArrangementNote: null,
      }
    }
    return {
      platformFeeBps: row.platformFeeBps,
      defaultFeeMode: row.defaultFeeMode as FeeHandlingMode,
      hasOverride: true,
      effectiveFrom: row.effectiveFrom,
      customArrangementNote: row.customArrangementNote,
    }
  })
}

// ─── setOverride ──────────────────────────────────────────────────────

export interface SetOverrideInput {
  tenantId: string
  actorUserId: string
  newFeeBps: number
  newMode: FeeHandlingMode
  reason: string
  /** Defaults to NOW. Per §14.4 "fee changes are not retroactive" —
   *  callers can schedule a future effective_from, but never a past one.
   *  This service does NOT enforce the not-past invariant; the calling
   *  route layer's zod schema or admin UI does (so the service stays
   *  pure on the input). */
  effectiveFrom?: Date
  /** Optional super-admin note captured on tenant_fee_config.
   *  Visible in the tenant's "Settings → Fees & Payouts" page per
   *  §14.4 "tenant sees their current fee". */
  customArrangementNote?: string | null
  ip?: string | null
  userAgent?: string | null
}

export interface SetOverrideResult {
  tenantId: string
  previousFeeBps: number
  newFeeBps: number
  previousMode: FeeHandlingMode
  newMode: FeeHandlingMode
  effectiveFrom: Date
  feeOverrideLogId: string
  isAnomalous: boolean
}

export async function setOverride(input: SetOverrideInput): Promise<SetOverrideResult> {
  if (input.newFeeBps < 0 || input.newFeeBps > 10000) {
    throw new FeeConfigInvalidBpsError(input.newFeeBps)
  }
  if (!input.reason?.trim()) {
    throw new FeeConfigReasonMissingError()
  }
  const effectiveFrom = input.effectiveFrom ?? new Date()

  return withSuperAdmin(async (tx) => {
    // 1. Read current state (with fallback to platform defaults).
    const currentRows = await tx
      .select({
        platformFeeBps: tenantFeeConfig.platformFeeBps,
        defaultFeeMode: tenantFeeConfig.defaultFeeMode,
      })
      .from(tenantFeeConfig)
      .where(eq(tenantFeeConfig.tenantId, input.tenantId))
      .limit(1)
    const previousFeeBps =
      (currentRows[0]?.platformFeeBps as number | undefined) ?? PLATFORM_DEFAULT_FEE_BPS
    const previousMode =
      (currentRows[0]?.defaultFeeMode as FeeHandlingMode | undefined) ?? PLATFORM_DEFAULT_FEE_MODE

    // 2. Anomaly flag — abs delta > 10 bps. Bps swap is independent of
    //    mode swap; mode swap alone is never anomalous (just a UX choice).
    const deltaBps = Math.abs(input.newFeeBps - previousFeeBps)
    const isAnomalous = deltaBps > ANOMALOUS_FEE_DELTA_BPS

    // 3. Append fee_override_log (the primary fee-specific audit shape).
    const inserted = await tx
      .insert(feeOverrideLog)
      .values({
        tenantId: input.tenantId,
        changedBy: input.actorUserId,
        previousFeeBps,
        newFeeBps: input.newFeeBps,
        previousMode,
        newMode: input.newMode,
        reason: input.reason,
        effectiveFrom,
      })
      .returning({ id: feeOverrideLog.id })
    const feeOverrideLogId = inserted[0]!.id

    // 4. UPSERT tenant_fee_config — first override creates the row;
    //    subsequent overrides mutate it. customArrangementNote is set
    //    explicitly when provided so an empty string can clear it.
    const tfcValues = {
      tenantId: input.tenantId,
      platformFeeBps: input.newFeeBps,
      defaultFeeMode: input.newMode,
      effectiveFrom,
      updatedBy: input.actorUserId,
      updatedAt: new Date(),
      ...(input.customArrangementNote !== undefined
        ? { customArrangementNote: input.customArrangementNote }
        : {}),
    }
    await tx
      .insert(tenantFeeConfig)
      .values(tfcValues)
      .onConflictDoUpdate({
        target: tenantFeeConfig.tenantId,
        set: {
          platformFeeBps: tfcValues.platformFeeBps,
          defaultFeeMode: tfcValues.defaultFeeMode,
          effectiveFrom: tfcValues.effectiveFrom,
          updatedBy: tfcValues.updatedBy,
          updatedAt: tfcValues.updatedAt,
          ...(input.customArrangementNote !== undefined
            ? { customArrangementNote: tfcValues.customArrangementNote }
            : {}),
        },
      })

    // 5. Cross-domain audit_logs row (sibling to fee_override_log per
    //    services/audit/fee-config.ts module header rationale).
    await writeFeeOverrideSet(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorRole: 'super_admin',
      previousFeeBps,
      newFeeBps: input.newFeeBps,
      previousMode,
      newMode: input.newMode,
      reason: input.reason,
      effectiveFrom,
      feeOverrideLogId,
      isAnomalous,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })

    if (isAnomalous) {
      // Log-only for Day 23 — the 4-eyes Slack notification wires in at
      // Phase 2 super-admin tooling Sprint 6+. Until then, anomalous
      // changes are findable via `SELECT ... FROM audit_logs WHERE
      // metadata->>'is_anomalous' = 'true'` for incident review.
      logger.warn(
        {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          previousFeeBps,
          newFeeBps: input.newFeeBps,
          deltaBps,
          reason: input.reason,
        },
        'fee override exceeds ±10 bps anomaly threshold (§14.4 4-eyes signal)',
      )
    }

    return {
      tenantId: input.tenantId,
      previousFeeBps,
      newFeeBps: input.newFeeBps,
      previousMode,
      newMode: input.newMode,
      effectiveFrom,
      feeOverrideLogId,
      isAnomalous,
    }
  })
}

// ─── clearOverride ────────────────────────────────────────────────────

export interface ClearOverrideInput {
  tenantId: string
  actorUserId: string
  reason: string
  ip?: string | null
  userAgent?: string | null
}

export async function clearOverride(input: ClearOverrideInput): Promise<SetOverrideResult> {
  return setOverride({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    newFeeBps: PLATFORM_DEFAULT_FEE_BPS,
    newMode: PLATFORM_DEFAULT_FEE_MODE,
    reason: input.reason,
    customArrangementNote: null,
    ip: input.ip,
    userAgent: input.userAgent,
  })
}

// ─── getHistory ───────────────────────────────────────────────────────

export interface FeeOverrideHistoryEntry {
  id: string
  changedBy: string
  previousFeeBps: number
  newFeeBps: number
  previousMode: FeeHandlingMode
  newMode: FeeHandlingMode
  reason: string
  effectiveFrom: Date
  createdAt: Date
}

export async function getHistory(tenantId: string, limit = 50): Promise<FeeOverrideHistoryEntry[]> {
  const cap = Math.min(Math.max(limit, 1), 200)
  return withSuperAdmin(async (db) => {
    const rows = await db
      .select()
      .from(feeOverrideLog)
      .where(eq(feeOverrideLog.tenantId, tenantId))
      .orderBy(desc(feeOverrideLog.createdAt))
      .limit(cap)
    return rows.map((r) => ({
      id: r.id,
      changedBy: r.changedBy,
      previousFeeBps: r.previousFeeBps,
      newFeeBps: r.newFeeBps,
      previousMode: r.previousMode as FeeHandlingMode,
      newMode: r.newMode as FeeHandlingMode,
      reason: r.reason,
      effectiveFrom: r.effectiveFrom,
      createdAt: r.createdAt,
    }))
  })
}

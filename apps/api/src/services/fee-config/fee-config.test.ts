/**
 * Fee-config service integration tests — Sprint 3 Day 23 Workstream 2.
 *
 * Covers the four service-layer functions per §14.4 + §9.12. NO money
 * math is tested here (none exists — the service stores bps, the
 * calculator consumes bps). Tests focus on:
 *
 *   1. getEffectiveFees — fallback to platform defaults + read-through
 *      when override row exists.
 *   2. setOverride — atomic UPSERT + fee_override_log INSERT + audit row;
 *      anomaly flag on >10 bps delta; reason required.
 *   3. clearOverride — round-trip back to platform defaults with audit.
 *   4. getHistory — newest-first ordering + limit clamp.
 *
 * RLS note: fee_override_log + tenant_fee_config writes go through
 * withSuperAdmin (BYPASSRLS) because per §10.4 + §14.4 only super
 * admins can change fees. There is no tenant-context write path to
 * test — RLS isolation on the read side is exercised by §9.12's
 * tenant_fee_config self-select policy (tested in 0001 RLS test).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { resetPool, withSuperAdmin } from '../../db/client.js'
import {
  auditLogs,
  feeOverrideLog,
  tenantFeeConfig,
  tenants,
  users,
} from '../../db/schema/index.js'
import {
  ANOMALOUS_FEE_DELTA_BPS,
  FeeConfigInvalidBpsError,
  FeeConfigReasonMissingError,
  PLATFORM_DEFAULT_FEE_BPS,
  PLATFORM_DEFAULT_FEE_MODE,
  clearOverride,
  getEffectiveFees,
  getHistory,
  setOverride,
} from './index.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

interface Fixture {
  actorUserId: string
  tenantWithConfigId: string
  tenantNoConfigId: string
}

describeIfDb('fee-config service — Workstream 2', () => {
  const fx: Fixture = {} as Fixture

  beforeAll(async () => {
    await withSuperAdmin(async (db) => {
      const [actor] = await db
        .insert(users)
        .values({
          email: `fee-config-test-${Date.now()}@test.local`,
          fullName: 'Fee Config Test Actor',
        })
        .returning({ id: users.id })
      fx.actorUserId = actor!.id

      const slug1 = `fee-config-test-tenant-a-${Date.now()}`
      const [t1] = await db
        .insert(tenants)
        .values({
          name: 'Fee Config Test Tenant A',
          slug: slug1,
          isPersonal: true,
          ownerUserId: fx.actorUserId,
          type: 'organisation',
        })
        .returning({ id: tenants.id })
      fx.tenantWithConfigId = t1!.id

      const slug2 = `fee-config-test-tenant-b-${Date.now()}`
      const [t2] = await db
        .insert(tenants)
        .values({
          name: 'Fee Config Test Tenant B',
          slug: slug2,
          isPersonal: true,
          ownerUserId: fx.actorUserId,
          type: 'organisation',
        })
        .returning({ id: tenants.id })
      fx.tenantNoConfigId = t2!.id
    })
  })

  afterAll(async () => {
    await withSuperAdmin(async (db) => {
      for (const tid of [fx.tenantWithConfigId, fx.tenantNoConfigId]) {
        if (!tid) continue
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, tid))
        await db.delete(feeOverrideLog).where(eq(feeOverrideLog.tenantId, tid))
        await db.delete(tenantFeeConfig).where(eq(tenantFeeConfig.tenantId, tid))
        await db.delete(tenants).where(eq(tenants.id, tid))
      }
      if (fx.actorUserId) await db.delete(users).where(eq(users.id, fx.actorUserId))
    })
    await resetPool()
  })

  beforeEach(async () => {
    await withSuperAdmin(async (db) => {
      for (const tid of [fx.tenantWithConfigId, fx.tenantNoConfigId]) {
        if (!tid) continue
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, tid))
        await db.delete(feeOverrideLog).where(eq(feeOverrideLog.tenantId, tid))
        await db.delete(tenantFeeConfig).where(eq(tenantFeeConfig.tenantId, tid))
      }
    })
  })

  // ─── getEffectiveFees ──────────────────────────────────────────────

  describe('getEffectiveFees', () => {
    it('returns platform defaults when no tenant_fee_config row exists', async () => {
      const result = await getEffectiveFees(fx.tenantNoConfigId)
      expect(result.platformFeeBps).toBe(PLATFORM_DEFAULT_FEE_BPS)
      expect(result.defaultFeeMode).toBe(PLATFORM_DEFAULT_FEE_MODE)
      expect(result.hasOverride).toBe(false)
      expect(result.effectiveFrom).toBeNull()
      expect(result.customArrangementNote).toBeNull()
    })

    it('reads existing tenant_fee_config row after setOverride', async () => {
      await setOverride({
        tenantId: fx.tenantWithConfigId,
        actorUserId: fx.actorUserId,
        newFeeBps: 30,
        newMode: 'absorb',
        reason: 'enterprise discount agreement',
      })
      const result = await getEffectiveFees(fx.tenantWithConfigId)
      expect(result.platformFeeBps).toBe(30)
      expect(result.defaultFeeMode).toBe('absorb')
      expect(result.hasOverride).toBe(true)
      expect(result.effectiveFrom).not.toBeNull()
    })
  })

  // ─── setOverride ───────────────────────────────────────────────────

  describe('setOverride', () => {
    it('writes fee_override_log + tenant_fee_config + audit row atomically', async () => {
      const result = await setOverride({
        tenantId: fx.tenantWithConfigId,
        actorUserId: fx.actorUserId,
        newFeeBps: 20,
        newMode: 'absorb',
        reason: 'pricing experiment Q3',
      })
      expect(result.previousFeeBps).toBe(PLATFORM_DEFAULT_FEE_BPS)
      expect(result.newFeeBps).toBe(20)
      expect(result.previousMode).toBe(PLATFORM_DEFAULT_FEE_MODE)
      expect(result.newMode).toBe('absorb')
      expect(result.isAnomalous).toBe(false) // delta = 5 bps, under threshold

      await withSuperAdmin(async (db) => {
        const logRows = await db
          .select()
          .from(feeOverrideLog)
          .where(eq(feeOverrideLog.tenantId, fx.tenantWithConfigId))
        expect(logRows).toHaveLength(1)
        expect(logRows[0]!.previousFeeBps).toBe(PLATFORM_DEFAULT_FEE_BPS)
        expect(logRows[0]!.newFeeBps).toBe(20)
        expect(logRows[0]!.reason).toBe('pricing experiment Q3')

        const cfgRows = await db
          .select()
          .from(tenantFeeConfig)
          .where(eq(tenantFeeConfig.tenantId, fx.tenantWithConfigId))
        expect(cfgRows).toHaveLength(1)
        expect(cfgRows[0]!.platformFeeBps).toBe(20)
        expect(cfgRows[0]!.defaultFeeMode).toBe('absorb')

        const auditRows = await db
          .select({ action: auditLogs.action, diff: auditLogs.diff, metadata: auditLogs.metadata })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.tenantId, fx.tenantWithConfigId),
              eq(auditLogs.action, 'tenant.fee_overridden'),
            ),
          )
        expect(auditRows).toHaveLength(1)
        const diff = auditRows[0]?.diff as {
          fee_bps: { from: number; to: number }
          mode: { from: string; to: string }
          reason: string
        }
        expect(diff.fee_bps).toEqual({ from: PLATFORM_DEFAULT_FEE_BPS, to: 20 })
        expect(diff.mode).toEqual({ from: PLATFORM_DEFAULT_FEE_MODE, to: 'absorb' })
        expect(diff.reason).toBe('pricing experiment Q3')
        const meta = auditRows[0]?.metadata as {
          is_anomalous: boolean
          fee_override_log_id: string
        }
        expect(meta.is_anomalous).toBe(false)
        expect(meta.fee_override_log_id).toBe(logRows[0]!.id)
      })
    })

    it('flags is_anomalous when delta > 10 bps', async () => {
      // delta = 35 - 25 = 10. NOT anomalous (threshold is STRICTLY >).
      const notAnomalous = await setOverride({
        tenantId: fx.tenantWithConfigId,
        actorUserId: fx.actorUserId,
        newFeeBps: PLATFORM_DEFAULT_FEE_BPS + ANOMALOUS_FEE_DELTA_BPS,
        newMode: 'pass_through',
        reason: 'edge case test',
      })
      expect(notAnomalous.isAnomalous).toBe(false)
    })

    it('flags is_anomalous when delta = 11 bps (strict >)', async () => {
      const anomalous = await setOverride({
        tenantId: fx.tenantWithConfigId,
        actorUserId: fx.actorUserId,
        newFeeBps: PLATFORM_DEFAULT_FEE_BPS + ANOMALOUS_FEE_DELTA_BPS + 1,
        newMode: 'pass_through',
        reason: 'enterprise rate',
      })
      expect(anomalous.isAnomalous).toBe(true)

      await withSuperAdmin(async (db) => {
        const auditRows = await db
          .select({ metadata: auditLogs.metadata })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.tenantId, fx.tenantWithConfigId),
              eq(auditLogs.action, 'tenant.fee_overridden'),
            ),
          )
        const meta = auditRows[0]?.metadata as { is_anomalous: boolean }
        expect(meta.is_anomalous).toBe(true)
      })
    })

    it('mode-only swap (same bps) is NEVER anomalous', async () => {
      const result = await setOverride({
        tenantId: fx.tenantWithConfigId,
        actorUserId: fx.actorUserId,
        newFeeBps: PLATFORM_DEFAULT_FEE_BPS,
        newMode: 'absorb',
        reason: 'switching default mode without changing rate',
      })
      expect(result.isAnomalous).toBe(false)
    })

    it('UPSERTs on second call (one fee_override_log per call but only one tenant_fee_config row)', async () => {
      await setOverride({
        tenantId: fx.tenantWithConfigId,
        actorUserId: fx.actorUserId,
        newFeeBps: 20,
        newMode: 'absorb',
        reason: 'first',
      })
      await setOverride({
        tenantId: fx.tenantWithConfigId,
        actorUserId: fx.actorUserId,
        newFeeBps: 15,
        newMode: 'pass_through',
        reason: 'second',
      })
      await withSuperAdmin(async (db) => {
        const logRows = await db
          .select()
          .from(feeOverrideLog)
          .where(eq(feeOverrideLog.tenantId, fx.tenantWithConfigId))
        expect(logRows).toHaveLength(2)

        const cfgRows = await db
          .select({ bps: tenantFeeConfig.platformFeeBps, mode: tenantFeeConfig.defaultFeeMode })
          .from(tenantFeeConfig)
          .where(eq(tenantFeeConfig.tenantId, fx.tenantWithConfigId))
        expect(cfgRows).toHaveLength(1)
        expect(cfgRows[0]!.bps).toBe(15)
        expect(cfgRows[0]!.mode).toBe('pass_through')
      })
    })

    it('persists customArrangementNote when provided', async () => {
      await setOverride({
        tenantId: fx.tenantWithConfigId,
        actorUserId: fx.actorUserId,
        newFeeBps: 12,
        newMode: 'absorb',
        reason: 'enterprise contract EP-2026-001',
        customArrangementNote: 'BDT 100,000/month minimum; contact legal@ for terms',
      })
      const result = await getEffectiveFees(fx.tenantWithConfigId)
      expect(result.customArrangementNote).toBe(
        'BDT 100,000/month minimum; contact legal@ for terms',
      )
    })

    it('throws FeeConfigInvalidBpsError on out-of-range bps', async () => {
      await expect(
        setOverride({
          tenantId: fx.tenantWithConfigId,
          actorUserId: fx.actorUserId,
          newFeeBps: -1,
          newMode: 'pass_through',
          reason: 'invalid',
        }),
      ).rejects.toBeInstanceOf(FeeConfigInvalidBpsError)
      await expect(
        setOverride({
          tenantId: fx.tenantWithConfigId,
          actorUserId: fx.actorUserId,
          newFeeBps: 10001,
          newMode: 'pass_through',
          reason: 'invalid',
        }),
      ).rejects.toBeInstanceOf(FeeConfigInvalidBpsError)
    })

    it('throws FeeConfigReasonMissingError when reason is empty', async () => {
      await expect(
        setOverride({
          tenantId: fx.tenantWithConfigId,
          actorUserId: fx.actorUserId,
          newFeeBps: 20,
          newMode: 'absorb',
          reason: '',
        }),
      ).rejects.toBeInstanceOf(FeeConfigReasonMissingError)
      await expect(
        setOverride({
          tenantId: fx.tenantWithConfigId,
          actorUserId: fx.actorUserId,
          newFeeBps: 20,
          newMode: 'absorb',
          reason: '   ',
        }),
      ).rejects.toBeInstanceOf(FeeConfigReasonMissingError)
    })
  })

  // ─── clearOverride ─────────────────────────────────────────────────

  describe('clearOverride', () => {
    it('resets to platform defaults + writes audit row + log entry', async () => {
      await setOverride({
        tenantId: fx.tenantWithConfigId,
        actorUserId: fx.actorUserId,
        newFeeBps: 50,
        newMode: 'absorb',
        reason: 'temporary promo rate',
      })
      const result = await clearOverride({
        tenantId: fx.tenantWithConfigId,
        actorUserId: fx.actorUserId,
        reason: 'promo expired',
      })
      expect(result.previousFeeBps).toBe(50)
      expect(result.newFeeBps).toBe(PLATFORM_DEFAULT_FEE_BPS)
      expect(result.previousMode).toBe('absorb')
      expect(result.newMode).toBe(PLATFORM_DEFAULT_FEE_MODE)

      const effective = await getEffectiveFees(fx.tenantWithConfigId)
      expect(effective.platformFeeBps).toBe(PLATFORM_DEFAULT_FEE_BPS)
      expect(effective.defaultFeeMode).toBe(PLATFORM_DEFAULT_FEE_MODE)
      expect(effective.customArrangementNote).toBeNull()

      await withSuperAdmin(async (db) => {
        const logRows = await db
          .select()
          .from(feeOverrideLog)
          .where(eq(feeOverrideLog.tenantId, fx.tenantWithConfigId))
        expect(logRows).toHaveLength(2) // setOverride + clearOverride
      })
    })
  })

  // ─── getHistory ────────────────────────────────────────────────────

  describe('getHistory', () => {
    it('returns newest-first', async () => {
      await setOverride({
        tenantId: fx.tenantWithConfigId,
        actorUserId: fx.actorUserId,
        newFeeBps: 20,
        newMode: 'absorb',
        reason: 'first',
      })
      await setOverride({
        tenantId: fx.tenantWithConfigId,
        actorUserId: fx.actorUserId,
        newFeeBps: 15,
        newMode: 'pass_through',
        reason: 'second',
      })
      await setOverride({
        tenantId: fx.tenantWithConfigId,
        actorUserId: fx.actorUserId,
        newFeeBps: 30,
        newMode: 'absorb',
        reason: 'third',
      })
      const history = await getHistory(fx.tenantWithConfigId)
      expect(history).toHaveLength(3)
      expect(history[0]?.reason).toBe('third')
      expect(history[1]?.reason).toBe('second')
      expect(history[2]?.reason).toBe('first')
    })

    it('honours limit clamp (1..200)', async () => {
      // Insert 3 rows
      for (let i = 0; i < 3; i++) {
        await setOverride({
          tenantId: fx.tenantWithConfigId,
          actorUserId: fx.actorUserId,
          newFeeBps: 20 + i,
          newMode: 'absorb',
          reason: `entry ${i}`,
        })
      }
      const limited = await getHistory(fx.tenantWithConfigId, 2)
      expect(limited).toHaveLength(2)
    })
  })
})

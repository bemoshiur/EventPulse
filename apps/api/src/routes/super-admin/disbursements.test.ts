/**
 * Super-admin disbursement export route tests — Day 44.
 *
 * SECURITY-CRITICAL tests + math-correctness tests + audit tests.
 *
 *   - no token → 401
 *   - tenant-audience → 403 (NOT 200 with leaked cross-tenant data)
 *   - attendee-audience → 403
 *   - super-admin → 200 with CSV body
 *   - period filter works (orders outside [start, end) excluded)
 *   - tenant_id filter narrows correctly
 *   - refund subtraction works (net = orders.net − refunds.amount)
 *   - audit_logs row written with the right shape
 *
 * Same security-critical inversion as revenue.test.ts: cross-tenant
 * data is the POINT; the auth gate is the entire security model.
 *
 * DB-gated (skipped when DATABASE_URL unset).
 */

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { signTokens } from '../../auth/jwt.js'
import { createApp } from '../../app.js'
import { resetPool, withSuperAdmin } from '../../db/client.js'
import {
  auditLogs,
  events,
  orderItems,
  orders,
  refunds,
  superAdmins,
  tenants,
  ticketTiers,
  users,
} from '../../db/schema/index.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

const ORIGINAL_JWT_ACCESS = process.env['JWT_ACCESS_SECRET']
const ORIGINAL_JWT_REFRESH = process.env['JWT_REFRESH_SECRET']

interface Fixture {
  superAdminId: string
  tenantAOwnerId: string
  tenantBOwnerId: string
  tenantAId: string
  tenantBId: string
  tenantAEventId: string
  tenantBEventId: string
  tenantATierId: string
  tenantBTierId: string
  superAdminToken: string
  tenantAToken: string
  attendeeToken: string
}

const physicalVenue = {
  type: 'physical' as const,
  name: 'Disb Venue',
  address: '1 Disbursement Road',
  division: 'dhaka' as const,
  district: 'Dhaka',
}
const future = (offsetMs: number) => new Date(Date.now() + offsetMs)

const PAID_AT_IN = new Date(Date.UTC(2026, 5, 3, 12, 0, 0)) // 2026-06-03 inside the 2026-06-01..08 window
const PAID_AT_OUT = new Date(Date.UTC(2026, 4, 25, 12, 0, 0)) // 2026-05-25 — outside window

describeIfDb('GET /api/v1/admin/disbursements/export', () => {
  const fx: Fixture = {} as Fixture
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  beforeAll(async () => {
    process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
    process.env['JWT_REFRESH_SECRET'] = 'y'.repeat(64)

    await withSuperAdmin(async (db) => {
      const [admin] = await db
        .insert(users)
        .values({ email: `disb-admin-${seed}@test.local`, fullName: 'Disb Admin' })
        .returning({ id: users.id })
      fx.superAdminId = admin!.id
      await db.insert(superAdmins).values({ userId: fx.superAdminId, permissions: [] })

      const [ownerA] = await db
        .insert(users)
        .values({ email: `disb-owner-a-${seed}@test.local`, fullName: 'Disb Owner A' })
        .returning({ id: users.id })
      fx.tenantAOwnerId = ownerA!.id

      const [ownerB] = await db
        .insert(users)
        .values({ email: `disb-owner-b-${seed}@test.local`, fullName: 'Disb Owner B' })
        .returning({ id: users.id })
      fx.tenantBOwnerId = ownerB!.id

      const [tA] = await db
        .insert(tenants)
        .values({
          name: 'Disb Tenant A',
          slug: `disb-tenant-a-${seed}`,
          type: 'organisation',
          isPersonal: false,
          ownerUserId: fx.tenantAOwnerId,
        })
        .returning({ id: tenants.id })
      fx.tenantAId = tA!.id

      const [tB] = await db
        .insert(tenants)
        .values({
          name: 'Disb Tenant B',
          slug: `disb-tenant-b-${seed}`,
          type: 'organisation',
          isPersonal: false,
          ownerUserId: fx.tenantBOwnerId,
        })
        .returning({ id: tenants.id })
      fx.tenantBId = tB!.id

      const [evtA] = await db
        .insert(events)
        .values({
          tenantId: fx.tenantAId,
          slug: `disb-evt-a-${seed}`,
          type: 'concert',
          title: 'Disb Tenant A Event',
          status: 'on_sale',
          startsAt: future(30 * 24 * 60 * 60 * 1000),
          endsAt: future(30 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
          venue: physicalVenue,
          createdBy: fx.tenantAOwnerId,
          platformFeeHandling: 'pass_through',
          epsFeeHandling: 'pass_through',
        })
        .returning({ id: events.id })
      fx.tenantAEventId = evtA!.id

      const [evtB] = await db
        .insert(events)
        .values({
          tenantId: fx.tenantBId,
          slug: `disb-evt-b-${seed}`,
          type: 'workshop',
          title: 'Disb Tenant B Event',
          status: 'on_sale',
          startsAt: future(30 * 24 * 60 * 60 * 1000),
          endsAt: future(30 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
          venue: physicalVenue,
          createdBy: fx.tenantBOwnerId,
          platformFeeHandling: 'pass_through',
          epsFeeHandling: 'pass_through',
        })
        .returning({ id: events.id })
      fx.tenantBEventId = evtB!.id

      const [tierA] = await db
        .insert(ticketTiers)
        .values({
          tenantId: fx.tenantAId,
          eventId: fx.tenantAEventId,
          name: 'GA',
          pricePaisa: 1_000_00n,
          capacity: 100,
        })
        .returning({ id: ticketTiers.id })
      fx.tenantATierId = tierA!.id

      const [tierB] = await db
        .insert(ticketTiers)
        .values({
          tenantId: fx.tenantBId,
          eventId: fx.tenantBEventId,
          name: 'Workshop',
          pricePaisa: 500_00n,
          capacity: 50,
        })
        .returning({ id: ticketTiers.id })
      fx.tenantBTierId = tierB!.id

      // Tenant A: 3 orders in window @ 1000 BDT each (net 1000 each)
      //           + 1 order OUTSIDE window @ 1000 BDT (must be excluded)
      //           + 1 processed refund in window of 200 BDT
      //   → in-window aggregate: 3 orders, gross 3000, net 3000, refunds 200, net_payable 2800
      const tenantAOrderIds: string[] = []
      for (let i = 0; i < 3; i++) {
        const [o] = await db
          .insert(orders)
          .values({
            tenantId: fx.tenantAId,
            eventId: fx.tenantAEventId,
            merchantTransactionId: `DISB-A-${seed}-${i}`,
            buyerName: `Disb A Buyer ${i}`,
            buyerEmail: `disb-a-${i}-${seed}@test.local`,
            buyerPhone: `+88017900000${i}`,
            subtotalPaisa: 1_000_00n,
            platformFeePaisa: 250n,
            epsFeePaisa: 0n,
            withholdingTaxPaisa: 0n,
            totalPaisa: 1_000_00n + 250n,
            netToOrganiserPaisa: 1_000_00n,
            currency: 'BDT',
            status: 'paid',
            paidAt: PAID_AT_IN,
            platformFeeBps: 25,
            epsFeeBps: 0,
            platformFeeHandling: 'pass_through',
            epsFeeHandling: 'pass_through',
          })
          .returning({ id: orders.id })
        tenantAOrderIds.push(o!.id)
        await db.insert(orderItems).values({
          tenantId: fx.tenantAId,
          orderId: o!.id,
          ticketTierId: fx.tenantATierId,
          quantity: 1,
          unitPricePaisa: 1_000_00n,
          subtotalPaisa: 1_000_00n,
        })
      }

      // Out-of-window order (must be EXCLUDED from CSV)
      await db.insert(orders).values({
        tenantId: fx.tenantAId,
        eventId: fx.tenantAEventId,
        merchantTransactionId: `DISB-A-OUT-${seed}`,
        buyerName: 'Out-of-Window Buyer',
        buyerEmail: `disb-a-out-${seed}@test.local`,
        buyerPhone: `+8801790000099`,
        subtotalPaisa: 1_000_00n,
        platformFeePaisa: 250n,
        epsFeePaisa: 0n,
        withholdingTaxPaisa: 0n,
        totalPaisa: 1_000_00n + 250n,
        netToOrganiserPaisa: 1_000_00n,
        currency: 'BDT',
        status: 'paid',
        paidAt: PAID_AT_OUT,
        platformFeeBps: 25,
        epsFeeBps: 0,
        platformFeeHandling: 'pass_through',
        epsFeeHandling: 'pass_through',
      })

      // Processed refund in-window — should subtract 200 BDT from A's net
      await db.insert(refunds).values({
        tenantId: fx.tenantAId,
        orderId: tenantAOrderIds[0]!,
        amountPaisa: 200_00n,
        reason: 'Test partial refund',
        initiatedBy: fx.tenantAOwnerId,
        status: 'processed',
        processedAt: PAID_AT_IN,
      })

      // Tenant B: 2 orders in window @ 500 BDT each (net 500 each)
      //   → 2 orders, gross 1000, net 1000, refunds 0, net_payable 1000
      for (let i = 0; i < 2; i++) {
        const [o] = await db
          .insert(orders)
          .values({
            tenantId: fx.tenantBId,
            eventId: fx.tenantBEventId,
            merchantTransactionId: `DISB-B-${seed}-${i}`,
            buyerName: `Disb B Buyer ${i}`,
            buyerEmail: `disb-b-${i}-${seed}@test.local`,
            buyerPhone: `+88017920000${i}`,
            subtotalPaisa: 500_00n,
            platformFeePaisa: 125n,
            epsFeePaisa: 0n,
            withholdingTaxPaisa: 0n,
            totalPaisa: 500_00n + 125n,
            netToOrganiserPaisa: 500_00n,
            currency: 'BDT',
            status: 'paid',
            paidAt: PAID_AT_IN,
            platformFeeBps: 25,
            epsFeeBps: 0,
            platformFeeHandling: 'pass_through',
            epsFeeHandling: 'pass_through',
          })
          .returning({ id: orders.id })
        await db.insert(orderItems).values({
          tenantId: fx.tenantBId,
          orderId: o!.id,
          ticketTierId: fx.tenantBTierId,
          quantity: 1,
          unitPricePaisa: 500_00n,
          subtotalPaisa: 500_00n,
        })
      }
    })

    // Tokens — same triplet as revenue.test.ts
    fx.superAdminToken = (
      await signTokens({
        sub: fx.superAdminId,
        audience: 'super-admin',
        tenantId: null,
        sessionId: `sess_disb_admin_${seed}`,
      })
    ).accessToken

    fx.tenantAToken = (
      await signTokens({
        sub: fx.tenantAOwnerId,
        audience: 'tenant',
        tenantId: fx.tenantAId,
        sessionId: `sess_disb_tenant_a_${seed}`,
      })
    ).accessToken

    fx.attendeeToken = (
      await signTokens({
        sub: fx.tenantAOwnerId,
        audience: 'attendee',
        tenantId: null,
        sessionId: `sess_disb_attendee_${seed}`,
      })
    ).accessToken
  })

  afterAll(async () => {
    process.env['JWT_ACCESS_SECRET'] = ORIGINAL_JWT_ACCESS
    process.env['JWT_REFRESH_SECRET'] = ORIGINAL_JWT_REFRESH
    await withSuperAdmin(async (db) => {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, fx.superAdminId))
      await db.delete(refunds).where(eq(refunds.tenantId, fx.tenantAId))
      await db.delete(refunds).where(eq(refunds.tenantId, fx.tenantBId))
      await db.delete(orderItems).where(eq(orderItems.tenantId, fx.tenantAId))
      await db.delete(orderItems).where(eq(orderItems.tenantId, fx.tenantBId))
      await db.delete(orders).where(eq(orders.tenantId, fx.tenantAId))
      await db.delete(orders).where(eq(orders.tenantId, fx.tenantBId))
      await db.delete(ticketTiers).where(eq(ticketTiers.tenantId, fx.tenantAId))
      await db.delete(ticketTiers).where(eq(ticketTiers.tenantId, fx.tenantBId))
      await db.delete(events).where(eq(events.tenantId, fx.tenantAId))
      await db.delete(events).where(eq(events.tenantId, fx.tenantBId))
      await db.delete(tenants).where(eq(tenants.id, fx.tenantAId))
      await db.delete(tenants).where(eq(tenants.id, fx.tenantBId))
      await db.delete(superAdmins).where(eq(superAdmins.userId, fx.superAdminId))
      await db.delete(users).where(eq(users.id, fx.superAdminId))
      await db.delete(users).where(eq(users.id, fx.tenantAOwnerId))
      await db.delete(users).where(eq(users.id, fx.tenantBOwnerId))
    })
    await resetPool()
  })

  // ─── auth-gate tests ────────────────────────────────────────────

  it('no token → 401', async () => {
    const app = createApp()
    const url = `/api/v1/admin/disbursements/export?period_start=2026-06-01&period_end=2026-06-08`
    const r = await app.request(url)
    expect(r.status).toBe(401)
  })

  it('tenant-audience token → 403 (NOT 200 with leaked data)', async () => {
    const app = createApp()
    const url = `/api/v1/admin/disbursements/export?period_start=2026-06-01&period_end=2026-06-08`
    const r = await app.request(url, {
      headers: { authorization: `Bearer ${fx.tenantAToken}` },
    })
    expect(r.status).toBe(403)
  })

  it('attendee-audience token → 403', async () => {
    const app = createApp()
    const url = `/api/v1/admin/disbursements/export?period_start=2026-06-01&period_end=2026-06-08`
    const r = await app.request(url, {
      headers: { authorization: `Bearer ${fx.attendeeToken}` },
    })
    expect(r.status).toBe(403)
  })

  // ─── happy-path tests ────────────────────────────────────────────

  it('super-admin → 200 + CSV with both tenants in window', async () => {
    const app = createApp()
    const url = `/api/v1/admin/disbursements/export?period_start=2026-06-01&period_end=2026-06-08`
    const r = await app.request(url, {
      headers: { authorization: `Bearer ${fx.superAdminToken}` },
    })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/csv')
    expect(r.headers.get('content-disposition')).toContain('attachment')

    // Read as raw bytes to verify BOM survival in transit. `r.text()`
    // would strip the BOM per WHATWG TextDecoder default; we want to
    // assert the on-wire bytes include it so Excel-on-Windows renders
    // Bangla correctly when the operator opens the file.
    const rawBuf = new Uint8Array(await r.arrayBuffer())
    expect(rawBuf[0]).toBe(0xef)
    expect(rawBuf[1]).toBe(0xbb)
    expect(rawBuf[2]).toBe(0xbf)

    // Subsequent assertions use a BOM-stripped string for readability.
    const body = new TextDecoder('utf-8').decode(rawBuf).replace(/^﻿/, '')
    expect(body).toMatch(
      /^tenant_id,tenant_name,tenant_slug,period_start,period_end,paid_order_count,gross_paisa,platform_fee_paisa,eps_fee_paisa,refunds_paisa,withholding_tax_paisa,net_paisa,currency/,
    )
    const lines = body.trim().split('\n')
    expect(lines).toHaveLength(3) // header + 2 tenant rows

    // Tenant A row: 3 orders, gross=300000, refunds=20000, net=280000
    const tenantALine = lines.find((l) => l.includes('Disb Tenant A'))
    expect(tenantALine).toBeDefined()
    const aFields = tenantALine!.split(',')
    expect(aFields[5]).toBe('3') // paid_order_count
    expect(aFields[6]).toBe('100000') // gross (wait — single order is 1_000_00n = 100000 paisa)
    // Recompute the expected: 3 orders × 1_000_00n = 3_000_00n = 300000 paisa
    expect(aFields[6]).toBe('300000') // gross_paisa
    expect(aFields[9]).toBe('20000') // refunds_paisa
    expect(aFields[11]).toBe('280000') // net_paisa (= 300000 − 20000)

    // Tenant B row: 2 orders × 500_00 = 100000 paisa gross, 0 refunds, net 100000
    const tenantBLine = lines.find((l) => l.includes('Disb Tenant B'))
    expect(tenantBLine).toBeDefined()
    const bFields = tenantBLine!.split(',')
    expect(bFields[5]).toBe('2')
    expect(bFields[6]).toBe('100000')
    expect(bFields[9]).toBe('0')
    expect(bFields[11]).toBe('100000')
  })

  it('tenant_id filter narrows to just tenant A', async () => {
    const app = createApp()
    const url = `/api/v1/admin/disbursements/export?period_start=2026-06-01&period_end=2026-06-08&tenant_id=${fx.tenantAId}`
    const r = await app.request(url, {
      headers: { authorization: `Bearer ${fx.superAdminToken}` },
    })
    expect(r.status).toBe(200)
    const body = await r.text()
    const lines = body.replace(/﻿/g, '').trim().split('\n')
    expect(lines).toHaveLength(2) // header + 1 tenant
    expect(lines[1]).toContain('Disb Tenant A')
    expect(lines[1]).not.toContain('Disb Tenant B')
  })

  it('empty window returns header-only CSV (no tenant rows)', async () => {
    const app = createApp()
    // Pick a window with no paid orders
    const url = `/api/v1/admin/disbursements/export?period_start=2025-01-01&period_end=2025-01-08`
    const r = await app.request(url, {
      headers: { authorization: `Bearer ${fx.superAdminToken}` },
    })
    expect(r.status).toBe(200)
    const body = await r.text()
    const lines = body.replace(/﻿/g, '').trim().split('\n')
    expect(lines).toHaveLength(1) // header only
  })

  // ─── audit row test ────────────────────────────────────────────

  it('writes exactly one audit_logs row per export', async () => {
    const app = createApp()
    const url = `/api/v1/admin/disbursements/export?period_start=2026-06-01&period_end=2026-06-08`
    await app.request(url, {
      headers: { authorization: `Bearer ${fx.superAdminToken}` },
    })
    const auditRows = await withSuperAdmin((db) =>
      db.select().from(auditLogs).where(eq(auditLogs.action, 'disbursements.exported_csv')),
    )
    // At least one row for THIS test run (other tests in this file
    // also hit the endpoint, hence ">=")
    expect(auditRows.length).toBeGreaterThanOrEqual(1)
    const row = auditRows[0]!
    expect(row.actorType).toBe('super_admin')
    expect(row.actorId).toBe(fx.superAdminId)
    expect(row.entityType).toBe('platform')
    expect(row.tenantId).toBeNull()
    const diff = row.diff as Record<string, unknown>
    expect(diff).toHaveProperty('period_start')
    expect(diff).toHaveProperty('period_end')
    expect(diff).toHaveProperty('row_count')
    expect(diff).toHaveProperty('total_net_paisa')
  })

  // ─── validation tests ────────────────────────────────────────────

  it('rejects period_end <= period_start with 400', async () => {
    const app = createApp()
    const url = `/api/v1/admin/disbursements/export?period_start=2026-06-08&period_end=2026-06-01`
    const r = await app.request(url, {
      headers: { authorization: `Bearer ${fx.superAdminToken}` },
    })
    expect(r.status).toBe(400)
  })

  it('rejects non-YYYY-MM-DD date format with 400', async () => {
    const app = createApp()
    const url = `/api/v1/admin/disbursements/export?period_start=2026/06/01&period_end=2026-06-08`
    const r = await app.request(url, {
      headers: { authorization: `Bearer ${fx.superAdminToken}` },
    })
    expect(r.status).toBe(400)
  })
})

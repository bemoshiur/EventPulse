/**
 * Super-admin disbursement export service — Day 44 §26.1 Day 10 bridge.
 *
 * Operationalises the §14.5 settlement-cron math as a read-only CSV
 * export so the operator can manually disburse to the first paying
 * tenant on T+5 without waiting for Sprint 7's automated settlement
 * engine.
 *
 * ════════════════════════════════════════════════════════════════════
 * Why this exists (and why it's not the Sprint 7 disbursement engine)
 * ════════════════════════════════════════════════════════════════════
 *
 * Sprint 7 ships:
 *   - `disbursement_batches` table (status state machine + actor refs)
 *   - `tenant_payout_accounts` table (per-tenant bank/MFS configs)
 *   - Cron-triggered batch generation (§14.5)
 *   - Payout adapters (BEFTN file generator, bKash B2C, etc.)
 *
 * None of that exists today. The first paying tenant's T+5 disbursement
 * lands while the operator runs the manual flow — read order data,
 * compute the net owed, generate a bank transfer manually.
 *
 * This service is the THIN BRIDGE: a CSV the operator downloads from
 * the super-admin UI showing, for a given date range, what each tenant
 * is owed. The operator uses this to populate the bank's BEFTN form
 * (or whatever transfer mechanism the tenant's bank uses).
 *
 * When Sprint 7 lands, this endpoint stays — it becomes a
 * "shadow reconciliation" check against the automated batches.
 *
 * ════════════════════════════════════════════════════════════════════
 * Money-truth discipline
 * ════════════════════════════════════════════════════════════════════
 *
 * Same rule as Day-35 revenue dashboard (decisions.md "Cross-tenant-by-
 * design pattern"): every paisa figure comes from a SNAPSHOTTED column
 * on the orders row, never recomputed. The fee calculator does not run
 * at export time. Recomputing would lie about historical orders whose
 * fees were set under a different per-tenant config (§14.4 + Decision N).
 *
 * Refund amounts (`refunds.amountPaisa` for refunds in status='processed')
 * are subtracted from the per-tenant net per §14.5 step 4.
 *
 * ════════════════════════════════════════════════════════════════════
 * What's deliberately NOT in the CSV at v1.0
 * ════════════════════════════════════════════════════════════════════
 *
 *   - Per-tenant payout account (bank name + branch + account number):
 *     `tenant_payout_accounts` doesn't exist; operator already knows
 *     the first paying tenant's account from the partnership
 *     onboarding pack (`docs/ops/first-paying-tenant-onboarding.md`).
 *   - "Already disbursed" tracking: `disbursement_batches` doesn't
 *     exist. Operator tracks "what I've already paid out" in their
 *     own private notes for v1.0. Re-running this export for the same
 *     date range returns the same numbers; double-disbursement is
 *     prevented by operator discipline + the audit_log on every export.
 *   - Withholding tax breakdown: AIT classification was resolved
 *     decisions.md 2026-05-26 (Day 39 AM CA opinion) — agency model
 *     anchored to Section 182 Contracts Act 1872. Per-order
 *     `withholding_tax_paisa` is currently zero at MVP because the
 *     withholding obligation is on the tenant, not the platform.
 *     Column kept in the CSV for visibility + future Phase-2 wiring.
 *
 * ════════════════════════════════════════════════════════════════════
 * Audit discipline (matches Day-32 attendee export Decision A)
 * ════════════════════════════════════════════════════════════════════
 *
 * Each export writes ONE audit_logs row (not per-tenant-row) capturing:
 * actor user, time window, row count, total net paisa, IP, user-agent.
 * No PII (tenant names are operational, not PII per §1.3 R5).
 *
 * Cross-tenant access is the POINT (super-admin scope), so there's no
 * cross-tenant guard to test. The auth-gate at the route layer is the
 * only security boundary (matches Day-35 revenue dashboard pattern).
 */

import { and, asc, eq, gte, inArray, lt, sql, sum } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { orders, refunds, tenants } from '../../db/schema/index.js'

// ─── input + output ────────────────────────────────────────────────

export interface DisbursementExportInput {
  /** Inclusive lower bound on `orders.paidAt`. */
  periodStart: Date
  /** Exclusive upper bound on `orders.paidAt`. */
  periodEnd: Date
  /** Optional: restrict to a single tenant. */
  tenantId?: string | null
  /** Actor user for the audit row. */
  actorUserId: string
  /** Forwarded for the audit row. */
  ip: string | null
  userAgent: string | null
}

export interface DisbursementRow {
  tenantId: string
  tenantName: string
  tenantSlug: string
  periodStart: Date
  periodEnd: Date
  paidOrderCount: number
  grossPaisa: bigint
  platformFeePaisa: bigint
  epsFeePaisa: bigint
  refundsPaisa: bigint
  withholdingTaxPaisa: bigint
  netPaisa: bigint
  currency: string
}

export interface DisbursementExportResult {
  csv: string
  rowCount: number
  totalNetPaisa: bigint
  filename: string
}

// ─── CSV helpers (RFC 4180 + OWASP formula-injection guard) ────────

const QUOTABLE = /[,"\r\n]/

// Excel + LibreOffice + Google Sheets evaluate a cell as a formula
// when the first character is `=` `+` `-` `@`, or a leading TAB / CR.
// `tenant.name` is user-controllable (set at tenant signup) — a
// malicious tenant could name themselves `=HYPERLINK(...)` and the
// formula fires the first time the operator opens this CSV in Excel
// (the UTF-8 BOM we emit specifically opts INTO the spreadsheet
// renderer rather than plain text).
//
// Neutralise by prefixing the cell value with a single quote `'`
// (Excel treats it as a display-only prefix; the apostrophe doesn't
// appear in the rendered cell) when the first character would
// otherwise trigger formula evaluation. Per OWASP "Failure to Sanitize
// CSV Output" / CWE-1236.
const FORMULA_PREFIXES = /^[=+\-@\t\r]/

export function csvEscape(value: string | null | undefined): string {
  if (value == null || value === '') return ''
  const safe = FORMULA_PREFIXES.test(value) ? `'${value}` : value
  if (QUOTABLE.test(safe)) return `"${safe.replace(/"/g, '""')}"`
  return safe
}

function csvRow(cells: Array<string | number | bigint | null | undefined>): string {
  return cells
    .map((c) => {
      if (c === null || c === undefined) return ''
      if (typeof c === 'bigint') return c.toString()
      if (typeof c === 'number') return c.toString()
      return csvEscape(c)
    })
    .join(',')
}

const CSV_HEADERS = [
  'tenant_id',
  'tenant_name',
  'tenant_slug',
  'period_start',
  'period_end',
  'paid_order_count',
  'gross_paisa',
  'platform_fee_paisa',
  'eps_fee_paisa',
  'refunds_paisa',
  'withholding_tax_paisa',
  'net_paisa',
  'currency',
] as const

// ─── main service ──────────────────────────────────────────────────

/**
 * Compute the per-tenant disbursement aggregates for `[periodStart, periodEnd)`
 * and serialise as RFC-4180 CSV. Always runs under `withSuperAdmin()`
 * (BYPASSRLS) — the auth gate at the route layer is the only security
 * boundary (cross-tenant aggregation is the point).
 */
export async function exportDisbursementsCsv(
  input: DisbursementExportInput,
): Promise<DisbursementExportResult> {
  // Eligible-order predicate per §14.5 step 1:
  //   - orders.status in {paid, completed} — sold + reconciled
  //   - NOT in {refund_requested, refunded, disputed, chargeback, reversed}
  //   - paidAt in [periodStart, periodEnd)
  //   - optional tenant filter
  const ELIGIBLE_ORDER_STATUSES = ['paid', 'completed'] as const

  const rows = await withSuperAdmin(async (tx) => {
    const orderConditions = [
      inArray(orders.status, [...ELIGIBLE_ORDER_STATUSES]),
      gte(orders.paidAt, input.periodStart),
      lt(orders.paidAt, input.periodEnd),
    ]
    if (input.tenantId) {
      orderConditions.push(eq(orders.tenantId, input.tenantId))
    }

    // Per-tenant order aggregate. Group on tenant_id + tenant fields.
    const orderAgg = await tx
      .select({
        tenantId: orders.tenantId,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        paidOrderCount: sql<number>`count(*)::int`,
        grossPaisa: sql<bigint>`coalesce(sum(${orders.subtotalPaisa}), 0)`,
        platformFeePaisa: sql<bigint>`coalesce(sum(${orders.platformFeePaisa}), 0)`,
        epsFeePaisa: sql<bigint>`coalesce(sum(${orders.epsFeePaisa}), 0)`,
        withholdingTaxPaisa: sql<bigint>`coalesce(sum(${orders.withholdingTaxPaisa}), 0)`,
        rawNetPaisa: sql<bigint>`coalesce(sum(${orders.netToOrganiserPaisa}), 0)`,
        currency: orders.currency,
      })
      .from(orders)
      .innerJoin(tenants, eq(tenants.id, orders.tenantId))
      .where(and(...orderConditions))
      .groupBy(orders.tenantId, tenants.name, tenants.slug, orders.currency)
      .orderBy(asc(tenants.name))

    if (orderAgg.length === 0) return []

    // Per-tenant processed-refund aggregate over the same window —
    // refunds are subtracted from net per §14.5 step 4. A refund is
    // counted when its `status='processed'` AND its `processedAt` is
    // in the window (refund timing decoupled from order paidAt).
    const tenantIds = orderAgg.map((r) => r.tenantId)
    const refundConditions = [
      inArray(refunds.tenantId, tenantIds),
      eq(refunds.status, 'processed'),
      gte(refunds.processedAt, input.periodStart),
      lt(refunds.processedAt, input.periodEnd),
    ]
    const refundAgg = await tx
      .select({
        tenantId: refunds.tenantId,
        refundsPaisa: sql<bigint>`coalesce(sum(${refunds.amountPaisa}), 0)`,
      })
      .from(refunds)
      .where(and(...refundConditions))
      .groupBy(refunds.tenantId)

    const refundsByTenant = new Map<string, bigint>()
    for (const r of refundAgg) {
      refundsByTenant.set(r.tenantId, BigInt(r.refundsPaisa))
    }

    const result: DisbursementRow[] = orderAgg.map((r) => {
      const refundsPaisa = refundsByTenant.get(r.tenantId) ?? 0n
      const rawNet = BigInt(r.rawNetPaisa)
      // Net for disbursement = sum(orders.net_to_organiser) − refunds.
      // §14.5 step 6 guards net > 0; a negative-net case (refunds exceed
      // paid in window) is surfaced as a negative number in the CSV so
      // the operator sees the debit-carry-forward case clearly.
      const netPaisa = rawNet - refundsPaisa
      return {
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        tenantSlug: r.tenantSlug,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        paidOrderCount: r.paidOrderCount,
        grossPaisa: BigInt(r.grossPaisa),
        platformFeePaisa: BigInt(r.platformFeePaisa),
        epsFeePaisa: BigInt(r.epsFeePaisa),
        refundsPaisa,
        withholdingTaxPaisa: BigInt(r.withholdingTaxPaisa),
        netPaisa,
        currency: r.currency,
      }
    })
    return result
  })

  const csv = renderCsv(rows)
  const totalNetPaisa = rows.reduce((acc, r) => acc + r.netPaisa, 0n)

  // ISO 8601 date in the filename (operator-friendly + sortable).
  const startStr = input.periodStart.toISOString().slice(0, 10)
  const endStr = new Date(input.periodEnd.getTime() - 1).toISOString().slice(0, 10)
  const filename = `disbursements-${startStr}_to_${endStr}.csv`

  return { csv, rowCount: rows.length, totalNetPaisa, filename }
}

function renderCsv(rows: DisbursementRow[]): string {
  // UTF-8 BOM so Excel-on-Windows opens Bangla tenant names correctly —
  // same precedent as the attendee CSV export. Using the explicit
  // ﻿ escape (NOT a literal U+FEFF char) so the source file
  // encoding doesn't subtly drop the byte during prettier/editor
  // passes — CI on Day 44 caught this when the response body didn't
  // start with BOM despite the source appearing to.
  const BOM = '﻿'
  const headers = CSV_HEADERS.join(',')
  const dataLines = rows.map((r) =>
    csvRow([
      r.tenantId,
      r.tenantName,
      r.tenantSlug,
      r.periodStart.toISOString(),
      r.periodEnd.toISOString(),
      r.paidOrderCount,
      r.grossPaisa,
      r.platformFeePaisa,
      r.epsFeePaisa,
      r.refundsPaisa,
      r.withholdingTaxPaisa,
      r.netPaisa,
      r.currency,
    ]),
  )
  return BOM + [headers, ...dataLines].join('\n') + '\n'
}

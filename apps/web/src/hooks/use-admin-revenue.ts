'use client'

/**
 * useAdminRevenue — TanStack Query hook for the super-admin platform
 * revenue dashboard. Sprint 4 Day 35 Phase 2.
 *
 * Backed by: GET /api/v1/admin/revenue
 *            GET /api/v1/admin/revenue/ledger
 *
 * Cross-tenant aggregate data. NO PII (tenant names + slugs + paisa
 * sums only — no buyer info). Default TanStack Query cache settings
 * (staleTime 30s) are appropriate; this is operational data, refreshed
 * on demand.
 *
 * Auth: relies on the admin browser session (cookies). If the API
 * returns 401, the hook surfaces it and the page renders a
 * "session expired" state. The route layer (requireSuperAdminAuth)
 * is the security perimeter; the hook is a thin transport.
 */

import { useQuery } from '@tanstack/react-query'

// ─── shared API helpers ────────────────────────────────────────────

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

interface ApiErrorBody {
  error: { code: string; message: string }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    let code = `HTTP_${res.status}`
    try {
      const body = (await res.json()) as ApiErrorBody
      if (body.error?.message) message = body.error.message
      if (body.error?.code) code = body.error.code
    } catch {
      /* not JSON */
    }
    const err = new Error(message) as Error & { code?: string }
    err.code = code
    throw err
  }
  return (await res.json()) as T
}

function fetchWithCreds(input: RequestInfo, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: 'include' })
}

// ─── wire types (mirrors apps/api/src/services/admin/revenue.ts) ───

export interface RevenueHeadline {
  gmvPaisa: string
  platformRevenuePaisa: string
  transactionCount: number
  weightedTakeBps: number
  activeTenantCount: number
}

export interface RevenueTimeSeriesPoint {
  date: string // YYYY-MM-DD in Asia/Dhaka
  gmvPaisa: string
  platformRevenuePaisa: string
  transactionCount: number
}

export interface TopTenantRow {
  tenantId: string
  tenantName: string
  tenantSlug: string
  gmvPaisa: string
  platformRevenuePaisa: string
  transactionCount: number
}

export interface PendingPayoutRow {
  tenantId: string
  tenantName: string
  tenantSlug: string
  pendingPaisa: string
  paidOrderCount: number
}

export interface RefundRateAnomaly {
  tenantId: string
  tenantName: string
  tenantSlug: string
  paidOrderCount: number
  refundedOrderCount: number
  refundRateBps: number
}

export interface FeeChangeAnomaly {
  tenantId: string
  tenantName: string
  tenantSlug: string
  changedAt: string
  changedBy: string
  previousFeeBps: number
  newFeeBps: number
  previousMode: string
  newMode: string
  reason: string
  absDeltaBps: number
}

export interface RevenueDashboardEnvelope {
  data: {
    headline: RevenueHeadline
    timeSeries: RevenueTimeSeriesPoint[]
    topByGmv: TopTenantRow[]
    topByPlatformRevenue: TopTenantRow[]
    topByTransactions: TopTenantRow[]
    settlementQueue: PendingPayoutRow[]
    anomalies: {
      refundRates: RefundRateAnomaly[]
      feeChanges: FeeChangeAnomaly[]
      epsReconciliationPlaceholder: true
    }
  }
}

export interface LedgerOrderRow {
  orderId: string
  merchantTransactionId: string
  buyerEmail: string
  totalPaisa: string
  netToOrganiserPaisa: string
  platformFeePaisa: string
  epsFeePaisa: string
  withholdingTaxPaisa: string
  status: string
  paidAt: string | null
  eventId: string
  eventTitle: string
  tenantId: string
  tenantName: string
}

export interface LedgerEnvelope {
  data: {
    rows: LedgerOrderRow[]
    invariantOk: boolean
    invariantFailureOrderIds: string[]
  }
}

export interface RevenueFilter {
  fromDate?: string
  toDate?: string
  headlineFromDate?: string
}

export interface LedgerFilter {
  tenantId?: string
  eventId?: string
  fromDate?: string
  toDate?: string
  limit?: number
}

// ─── hooks ─────────────────────────────────────────────────────────

export const adminRevenueKeys = {
  all: ['admin', 'revenue'] as const,
  dashboard: (filter?: RevenueFilter) =>
    [...adminRevenueKeys.all, 'dashboard', filter ?? {}] as const,
  ledger: (filter?: LedgerFilter) => [...adminRevenueKeys.all, 'ledger', filter ?? {}] as const,
}

export function useAdminRevenue(filter?: RevenueFilter) {
  return useQuery({
    queryKey: adminRevenueKeys.dashboard(filter),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filter?.fromDate) params.set('fromDate', filter.fromDate)
      if (filter?.toDate) params.set('toDate', filter.toDate)
      if (filter?.headlineFromDate) params.set('headlineFromDate', filter.headlineFromDate)
      const qs = params.toString()
      const url = `${apiBase()}/api/v1/admin/revenue${qs ? `?${qs}` : ''}`
      const res = await fetchWithCreds(url)
      return jsonOrThrow<RevenueDashboardEnvelope>(res)
    },
  })
}

export function useAdminRevenueLedger(filter?: LedgerFilter, enabled = true) {
  return useQuery({
    queryKey: adminRevenueKeys.ledger(filter),
    enabled,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filter?.tenantId) params.set('tenantId', filter.tenantId)
      if (filter?.eventId) params.set('eventId', filter.eventId)
      if (filter?.fromDate) params.set('fromDate', filter.fromDate)
      if (filter?.toDate) params.set('toDate', filter.toDate)
      if (filter?.limit != null) params.set('limit', String(filter.limit))
      const qs = params.toString()
      const url = `${apiBase()}/api/v1/admin/revenue/ledger${qs ? `?${qs}` : ''}`
      const res = await fetchWithCreds(url)
      return jsonOrThrow<LedgerEnvelope>(res)
    },
  })
}

// ─── formatting helpers (shared shape with use-tenant-sales) ───────

export function formatBdt(paisaStr: string | number | null | undefined): string {
  if (paisaStr == null) return '৳ 0.00'
  const paisa = typeof paisaStr === 'string' ? BigInt(paisaStr) : BigInt(paisaStr)
  const sign = paisa < 0n ? '-' : ''
  const abs = paisa < 0n ? -paisa : paisa
  const major = abs / 100n
  const minor = abs % 100n
  const minorStr = minor.toString().padStart(2, '0')
  const majorStr = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}৳ ${majorStr}.${minorStr}`
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '0'
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function formatBps(bps: number | null | undefined): string {
  if (bps == null) return '0.00%'
  return `${(bps / 100).toFixed(2)}%`
}

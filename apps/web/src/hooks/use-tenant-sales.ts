'use client'

/**
 * useTenantSales — TanStack Query hook for the tenant sales dashboard.
 * Sprint 4 Day 33 Phase 2.
 *
 * Backed by: GET /api/v1/tenant/reports/sales
 *   ?eventId=...&fromDate=...&toDate=...
 *
 * No PII in the response (aggregates only). Default TanStack Query
 * cache settings (staleTime 30s) are fine — these numbers are
 * operational, not surveillance.
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

// ─── types (wire shape; paisa as bigint-string) ────────────────────

export interface SalesHeadline {
  grossRevenuePaisa: string
  netToOrganiserPaisa: string
  platformFeePaisa: string
  epsFeePaisa: string
  paidOrderCount: number
  ticketsSold: number
  buckets: {
    revenue: number
    pending: number
    dropped: number
    refunded: number
  }
}

export interface SalesTimeSeriesPoint {
  date: string // YYYY-MM-DD in Asia/Dhaka
  grossRevenuePaisa: string
  paidOrderCount: number
}

export interface EventBreakdownRow {
  eventId: string
  eventTitle: string
  eventSlug: string
  grossRevenuePaisa: string
  netToOrganiserPaisa: string
  paidOrderCount: number
  ticketsSold: number
}

export interface TierBreakdownRow {
  tierId: string
  tierName: string
  eventId: string
  eventTitle: string
  pricePaisa: string
  ticketsSold: number
  grossRevenuePaisa: string
}

export interface SalesEnvelope {
  data: {
    headline: SalesHeadline
    timeSeries: SalesTimeSeriesPoint[]
    eventBreakdown: EventBreakdownRow[]
    tierBreakdown: TierBreakdownRow[]
  }
}

export interface SalesFilter {
  eventId?: string
  fromDate?: string // ISO 8601
  toDate?: string
}

// ─── hook ──────────────────────────────────────────────────────────

export const tenantSalesKeys = {
  all: ['tenant', 'sales'] as const,
  byFilter: (filter?: SalesFilter) => [...tenantSalesKeys.all, filter ?? {}] as const,
}

export function useTenantSales(filter?: SalesFilter) {
  return useQuery({
    queryKey: tenantSalesKeys.byFilter(filter),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filter?.eventId) params.set('eventId', filter.eventId)
      if (filter?.fromDate) params.set('fromDate', filter.fromDate)
      if (filter?.toDate) params.set('toDate', filter.toDate)
      const qs = params.toString()
      const url = `${apiBase()}/api/v1/tenant/reports/sales${qs ? `?${qs}` : ''}`
      const res = await fetchWithCreds(url)
      return jsonOrThrow<SalesEnvelope>(res)
    },
  })
}

// ─── BDT formatting helper (shared with payouts view) ──────────────

/**
 * Format a paisa-as-string into a BDT display string with 2 decimals.
 * e.g. "12345" → "৳ 123.45". Negative or zero handled gracefully.
 */
export function formatBdt(paisaStr: string | number | null | undefined): string {
  if (paisaStr == null) return '৳ 0.00'
  const paisa = typeof paisaStr === 'string' ? BigInt(paisaStr) : BigInt(paisaStr)
  const sign = paisa < 0n ? '-' : ''
  const abs = paisa < 0n ? -paisa : paisa
  const major = abs / 100n
  const minor = abs % 100n
  const minorStr = minor.toString().padStart(2, '0')
  // Group thousands in the major part with the Bangladeshi numbering
  // pattern: 1,23,456 (lakh-style — 3 digits then 2-digit groups).
  // For MVP keep the simpler 12,345 style; revisit when bilingual UX
  // wants the Bangla-numeral lakh format.
  const majorStr = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}৳ ${majorStr}.${minorStr}`
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '0'
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

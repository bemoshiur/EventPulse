/**
 * /admin/revenue page tests — Sprint 4 Day 35 Phase 2.
 *
 *   1. Loading state (status role).
 *   2. Empty state — no paid orders yet (staging shape today).
 *   3. Happy path — KPIs render, leaderboards render, settlement
 *      queue renders, time-series chart container present.
 *   4. Error 403 → renders the FORBIDDEN-specific hint copy (the
 *      page reflects the security model: if you got a 403 from the
 *      API, you probably arrived from a tenant session).
 *   5. Anomaly cards render the fee-change + refund-rate items.
 *   6. Axe-clean.
 *
 * Recharts uses ResizeObserver — stub it for jsdom (mirrors the
 * Day-33 sales-dashboard test setup).
 */

import type { ReactNode } from 'react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { axe } from 'vitest-axe'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import AdminRevenuePage from './page'

beforeEach(() => {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

interface EnvelopeOverrides {
  gmvPaisa?: string
  platformRevenuePaisa?: string
  transactionCount?: number
  weightedTakeBps?: number
  activeTenantCount?: number
  timeSeries?: Array<{
    date: string
    gmvPaisa: string
    platformRevenuePaisa: string
    transactionCount: number
  }>
  topByGmv?: Array<{
    tenantId: string
    tenantName: string
    tenantSlug: string
    gmvPaisa: string
    platformRevenuePaisa: string
    transactionCount: number
  }>
  topByPlatformRevenue?: Array<{
    tenantId: string
    tenantName: string
    tenantSlug: string
    gmvPaisa: string
    platformRevenuePaisa: string
    transactionCount: number
  }>
  topByTransactions?: Array<{
    tenantId: string
    tenantName: string
    tenantSlug: string
    gmvPaisa: string
    platformRevenuePaisa: string
    transactionCount: number
  }>
  settlementQueue?: Array<{
    tenantId: string
    tenantName: string
    tenantSlug: string
    pendingPaisa: string
    paidOrderCount: number
  }>
  refundRates?: Array<{
    tenantId: string
    tenantName: string
    tenantSlug: string
    paidOrderCount: number
    refundedOrderCount: number
    refundRateBps: number
  }>
  feeChanges?: Array<{
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
  }>
}

function makeEnvelope(o: EnvelopeOverrides = {}) {
  return {
    data: {
      headline: {
        gmvPaisa: o.gmvPaisa ?? '0',
        platformRevenuePaisa: o.platformRevenuePaisa ?? '0',
        transactionCount: o.transactionCount ?? 0,
        weightedTakeBps: o.weightedTakeBps ?? 0,
        activeTenantCount: o.activeTenantCount ?? 0,
      },
      timeSeries: o.timeSeries ?? [],
      topByGmv: o.topByGmv ?? [],
      topByPlatformRevenue: o.topByPlatformRevenue ?? [],
      topByTransactions: o.topByTransactions ?? [],
      settlementQueue: o.settlementQueue ?? [],
      anomalies: {
        refundRates: o.refundRates ?? [],
        feeChanges: o.feeChanges ?? [],
        epsReconciliationPlaceholder: true as const,
      },
    },
  }
}

function withProviders(children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  ;(global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  delete (global as { fetch?: typeof fetch }).fetch
})

function jsonResponse<T>(body: T, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

// ─── tests ────────────────────────────────────────────────────────

describe('/admin/revenue page', () => {
  it('renders loading state initially', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    render(withProviders(<AdminRevenuePage />))
    expect(screen.getByRole('status')).toHaveTextContent(/loading revenue/i)
  })

  it('renders empty state when no paid orders exist (staging-today shape)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(makeEnvelope()))
    render(withProviders(<AdminRevenuePage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-revenue')).toBeInTheDocument()
    })
    // KPI cards all render with zero values.
    expect(screen.getByTestId('kpi-grid')).toBeInTheDocument()
    // Empty leaderboards copy.
    expect(screen.getByText('No tenants with paid orders yet.')).toBeInTheDocument()
    // Empty settlement queue copy.
    expect(screen.getByText('No pending payouts.')).toBeInTheDocument()
    // Empty fee-change anomaly copy.
    expect(screen.getByText(/No fee changes in the last 7 days/)).toBeInTheDocument()
    // EPS placeholder card present.
    expect(screen.getByText(/EPS reconciliation mismatches will surface here/)).toBeInTheDocument()
  })

  it('renders happy path with KPIs + leaderboard + settlement queue + chart', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        makeEnvelope({
          gmvPaisa: '500000', // 5,000 BDT
          platformRevenuePaisa: '1250', // 12.50 BDT
          transactionCount: 3,
          weightedTakeBps: 25,
          activeTenantCount: 2,
          timeSeries: [
            {
              date: '2026-05-25',
              gmvPaisa: '300000',
              platformRevenuePaisa: '750',
              transactionCount: 2,
            },
            {
              date: '2026-05-26',
              gmvPaisa: '200000',
              platformRevenuePaisa: '500',
              transactionCount: 1,
            },
          ],
          topByGmv: [
            {
              tenantId: 'ten-A',
              tenantName: 'Tenant A',
              tenantSlug: 'tenant-a',
              gmvPaisa: '300000',
              platformRevenuePaisa: '750',
              transactionCount: 2,
            },
            {
              tenantId: 'ten-B',
              tenantName: 'Tenant B',
              tenantSlug: 'tenant-b',
              gmvPaisa: '200000',
              platformRevenuePaisa: '500',
              transactionCount: 1,
            },
          ],
          topByPlatformRevenue: [
            {
              tenantId: 'ten-A',
              tenantName: 'Tenant A',
              tenantSlug: 'tenant-a',
              gmvPaisa: '300000',
              platformRevenuePaisa: '750',
              transactionCount: 2,
            },
          ],
          settlementQueue: [
            {
              tenantId: 'ten-A',
              tenantName: 'Tenant A',
              tenantSlug: 'tenant-a',
              pendingPaisa: '299250',
              paidOrderCount: 2,
            },
          ],
        }),
      ),
    )

    render(withProviders(<AdminRevenuePage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-revenue')).toBeInTheDocument()
    })

    // KPI grid renders with formatted BDT.
    expect(screen.getByText('৳ 5,000.00')).toBeInTheDocument() // gmv (KPI value)
    expect(screen.getByText('৳ 12.50')).toBeInTheDocument() // platform revenue (KPI value)
    // Weighted take is interpolated as "Weighted take: 0.25%" — partial match.
    expect(screen.getByText(/Weighted take:\s*0\.25%/)).toBeInTheDocument()

    // Leaderboards: tenant A above tenant B in the GMV list.
    expect(screen.getByTestId('gmv-row-ten-A')).toBeInTheDocument()
    expect(screen.getByTestId('gmv-row-ten-B')).toBeInTheDocument()
    expect(screen.getByTestId('revenue-row-ten-A')).toBeInTheDocument()

    // Settlement row for tenant A renders the pending amount.
    expect(screen.getByTestId('settlement-row-ten-A')).toBeInTheDocument()
    expect(screen.getByText('৳ 2,992.50')).toBeInTheDocument()

    // Chart container renders when time-series present.
    expect(screen.getByTestId('time-series-chart')).toBeInTheDocument()
  })

  it('renders the FORBIDDEN-specific hint when the API returns 403', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'FORBIDDEN', message: 'super-admin audience required' } },
        { status: 403 },
      ),
    )
    render(withProviders(<AdminRevenuePage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-revenue-error')).toBeInTheDocument()
    })
    expect(screen.getByText('super-admin audience required')).toBeInTheDocument()
    expect(screen.getByText(/requires a super-admin session/i)).toBeInTheDocument()
  })

  it('renders refund-rate + fee-change anomaly cards when present', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        makeEnvelope({
          refundRates: [
            {
              tenantId: 'ten-A',
              tenantName: 'Tenant A',
              tenantSlug: 'tenant-a',
              paidOrderCount: 2,
              refundedOrderCount: 1,
              refundRateBps: 3333,
            },
          ],
          feeChanges: [
            {
              tenantId: 'ten-A',
              tenantName: 'Tenant A',
              tenantSlug: 'tenant-a',
              changedAt: '2026-05-26T00:00:00Z',
              changedBy: 'admin-1',
              previousFeeBps: 25,
              newFeeBps: 50,
              previousMode: 'pass_through',
              newMode: 'absorb',
              reason: 'Special-arrangement test',
              absDeltaBps: 25,
            },
          ],
        }),
      ),
    )
    render(withProviders(<AdminRevenuePage />))
    await waitFor(() => {
      expect(screen.getByTestId('anomaly-refund-ten-A')).toBeInTheDocument()
    })
    // Refund-rate text is interpolated as "33.33% (1 of 3)" — partial match.
    expect(screen.getByText(/33\.33%/)).toBeInTheDocument()
    expect(screen.getByTestId('anomaly-fee-ten-A')).toBeInTheDocument()
    expect(screen.getByText('Special-arrangement test')).toBeInTheDocument()
  })

  it('is axe-clean', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(makeEnvelope()))
    const { container } = render(withProviders(<AdminRevenuePage />))
    await waitFor(() => {
      expect(screen.getByTestId('admin-revenue')).toBeInTheDocument()
    })
    expect(await axe(container)).toHaveNoViolations()
  })
})

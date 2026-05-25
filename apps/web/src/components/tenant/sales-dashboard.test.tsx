/**
 * SalesDashboard — unit tests.
 * Sprint 4 Day 33 Phase 2.
 *
 *   1. Loading state (status role).
 *   2. Empty state when no revenue + no orders (the staging shape
 *      until paid orders exist; the "no sales yet" banner shows).
 *   3. Happy path: KPI cards render with formatted BDT values; bucket
 *      pills render with counts; per-event + per-tier tables render.
 *   4. Time-series renders the chart container when data is present.
 *   5. Error state (alert role) with API error message.
 *   6. Axe-clean on rendered dashboard.
 *
 * The Recharts chart components include SVG that jsdom can render
 * but won't fully measure (ResponsiveContainer needs layout); we
 * test the chart container is present + populated, not pixel sizes.
 */

import type { ReactNode } from 'react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { axe } from 'vitest-axe'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { SalesDashboard } from './sales-dashboard'

// Recharts uses ResizeObserver in ResponsiveContainer; jsdom doesn't
// have it. Stub a no-op so the chart renders without crashing.
beforeEach(() => {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

function makeEnvelope(
  overrides: {
    grossRevenuePaisa?: string
    netToOrganiserPaisa?: string
    platformFeePaisa?: string
    epsFeePaisa?: string
    paidOrderCount?: number
    ticketsSold?: number
    buckets?: { revenue: number; pending: number; dropped: number; refunded: number }
    timeSeries?: Array<{ date: string; grossRevenuePaisa: string; paidOrderCount: number }>
    eventBreakdown?: Array<{
      eventId: string
      eventTitle: string
      eventSlug: string
      grossRevenuePaisa: string
      netToOrganiserPaisa: string
      paidOrderCount: number
      ticketsSold: number
    }>
    tierBreakdown?: Array<{
      tierId: string
      tierName: string
      eventId: string
      eventTitle: string
      pricePaisa: string
      ticketsSold: number
      grossRevenuePaisa: string
    }>
  } = {},
) {
  return {
    data: {
      headline: {
        grossRevenuePaisa: overrides.grossRevenuePaisa ?? '0',
        netToOrganiserPaisa: overrides.netToOrganiserPaisa ?? '0',
        platformFeePaisa: overrides.platformFeePaisa ?? '0',
        epsFeePaisa: overrides.epsFeePaisa ?? '0',
        paidOrderCount: overrides.paidOrderCount ?? 0,
        ticketsSold: overrides.ticketsSold ?? 0,
        buckets: overrides.buckets ?? { revenue: 0, pending: 0, dropped: 0, refunded: 0 },
      },
      timeSeries: overrides.timeSeries ?? [],
      eventBreakdown: overrides.eventBreakdown ?? [],
      tierBreakdown: overrides.tierBreakdown ?? [],
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

// ─── loading + empty + happy ───────────────────────────────────────

describe('SalesDashboard — loading + empty + happy', () => {
  it('renders loading state initially (status role)', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    render(withProviders(<SalesDashboard />))
    expect(screen.getByRole('status')).toHaveTextContent(/loading sales metrics/i)
  })

  it('renders the empty-state banner when no revenue + no orders', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeEnvelope()))
    render(withProviders(<SalesDashboard />))
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument())
    expect(screen.getByTestId('empty-state')).toHaveTextContent(/no sales yet/i)
  })

  it('happy path: KPI cards render with formatted BDT values; bucket pills + tables render', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeEnvelope({
          // BDT 50,000.00 in paisa = 5,000,000
          grossRevenuePaisa: '5000000',
          netToOrganiserPaisa: '4800000',
          platformFeePaisa: '12500',
          epsFeePaisa: '125000',
          paidOrderCount: 25,
          ticketsSold: 50,
          buckets: { revenue: 25, pending: 3, dropped: 2, refunded: 1 },
          eventBreakdown: [
            {
              eventId: 'e1',
              eventTitle: 'Test Concert',
              eventSlug: 'test-concert',
              grossRevenuePaisa: '5000000',
              netToOrganiserPaisa: '4800000',
              paidOrderCount: 25,
              ticketsSold: 50,
            },
          ],
          tierBreakdown: [
            {
              tierId: 't1',
              tierName: 'General',
              eventId: 'e1',
              eventTitle: 'Test Concert',
              pricePaisa: '100000',
              ticketsSold: 50,
              grossRevenuePaisa: '5000000',
            },
          ],
        }),
      ),
    )
    render(withProviders(<SalesDashboard />))
    await waitFor(() => expect(screen.getByTestId('kpi-gross')).toBeInTheDocument())

    // KPI cards
    expect(screen.getByTestId('kpi-gross')).toHaveTextContent(/৳ 50,000\.00/)
    expect(screen.getByTestId('kpi-net')).toHaveTextContent(/৳ 48,000\.00/)
    expect(screen.getByTestId('kpi-tickets')).toHaveTextContent(/50/)
    // AOV = 50,000 / 25 = 2,000
    expect(screen.getByTestId('kpi-aov')).toHaveTextContent(/৳ 2,000\.00/)

    // Bucket pills
    const pills = screen.getByTestId('bucket-pills')
    expect(pills).toHaveTextContent(/revenue/i)
    expect(pills).toHaveTextContent(/pending/i)
    expect(pills).toHaveTextContent(/dropped/i)
    expect(pills).toHaveTextContent(/refunded/i)

    // Event + tier tables
    expect(screen.getAllByText('Test Concert').length).toBeGreaterThanOrEqual(2) // event + tier rows
    expect(screen.getByText('General')).toBeInTheDocument()
  })

  it('renders the time-series chart when data is present', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeEnvelope({
          grossRevenuePaisa: '100000',
          paidOrderCount: 1,
          timeSeries: [
            { date: '2026-05-20', grossRevenuePaisa: '50000', paidOrderCount: 1 },
            { date: '2026-05-21', grossRevenuePaisa: '50000', paidOrderCount: 1 },
          ],
        }),
      ),
    )
    render(withProviders(<SalesDashboard />))
    await waitFor(() => expect(screen.getByTestId('sales-chart')).toBeInTheDocument())
  })
})

// ─── error ──────────────────────────────────────────────────────────

describe('SalesDashboard — error state', () => {
  it('renders error message with role=alert on fetch failure', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    )
    render(withProviders(<SalesDashboard />))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/boom/)
  })
})

// ─── accessibility ─────────────────────────────────────────────────

describe('SalesDashboard — accessibility', () => {
  it('axe-clean on the happy-path render', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeEnvelope({
          grossRevenuePaisa: '100000',
          paidOrderCount: 1,
          ticketsSold: 1,
          buckets: { revenue: 1, pending: 0, dropped: 0, refunded: 0 },
          eventBreakdown: [
            {
              eventId: 'e1',
              eventTitle: 'Axe Event',
              eventSlug: 'axe',
              grossRevenuePaisa: '100000',
              netToOrganiserPaisa: '100000',
              paidOrderCount: 1,
              ticketsSold: 1,
            },
          ],
          tierBreakdown: [
            {
              tierId: 't1',
              tierName: 'GA',
              eventId: 'e1',
              eventTitle: 'Axe Event',
              pricePaisa: '100000',
              ticketsSold: 1,
              grossRevenuePaisa: '100000',
            },
          ],
        }),
      ),
    )
    const { container } = render(withProviders(<SalesDashboard />))
    await waitFor(() => expect(screen.getByTestId('kpi-gross')).toBeInTheDocument())
    expect(await axe(container)).toHaveNoViolations()
  })
})

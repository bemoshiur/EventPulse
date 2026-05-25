/**
 * PayoutsView — unit tests.
 * Sprint 4 Day 33 Phase 3.
 *
 *   1. Loading state.
 *   2. Empty state when no paid orders.
 *   3. Happy path: payable card + snapshot breakdown + current fees.
 *   4. Refund-leak card appears only when there are leak orders.
 *   5. Current-fee display reflects the bps from currentFees, NOT
 *      the snapshotted per-order fee.
 *   6. Error state.
 *   7. Axe-clean.
 */

import type { ReactNode } from 'react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { axe } from 'vitest-axe'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { PayoutsView } from './payouts-view'

function makeEnvelope(
  overrides: {
    pendingPayoutPaisa?: string
    grossRevenuePaisa?: string
    platformFeePaisa?: string
    epsFeePaisa?: string
    withholdingTaxPaisa?: string
    paidOrderCount?: number
    refundLeakOrderCount?: number
    refundLeakPaisa?: string
    currentFees?: {
      platformFeeBps?: number
      defaultFeeMode?: 'absorb' | 'pass_through'
      hasOverride?: boolean
      customArrangementNote?: string | null
    }
  } = {},
) {
  return {
    data: {
      pendingPayoutPaisa: overrides.pendingPayoutPaisa ?? '0',
      grossRevenuePaisa: overrides.grossRevenuePaisa ?? '0',
      platformFeePaisa: overrides.platformFeePaisa ?? '0',
      epsFeePaisa: overrides.epsFeePaisa ?? '0',
      withholdingTaxPaisa: overrides.withholdingTaxPaisa ?? '0',
      paidOrderCount: overrides.paidOrderCount ?? 0,
      refundLeakOrderCount: overrides.refundLeakOrderCount ?? 0,
      refundLeakPaisa: overrides.refundLeakPaisa ?? '0',
      currentFees: {
        platformFeeBps: overrides.currentFees?.platformFeeBps ?? 25,
        defaultFeeMode: overrides.currentFees?.defaultFeeMode ?? 'pass_through',
        hasOverride: overrides.currentFees?.hasOverride ?? false,
        effectiveFrom: null,
        customArrangementNote: overrides.currentFees?.customArrangementNote ?? null,
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

describe('PayoutsView — loading + empty + happy', () => {
  it('renders loading state initially (status role)', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    render(withProviders(<PayoutsView />))
    expect(screen.getByRole('status')).toHaveTextContent(/loading payouts/i)
  })

  it('renders empty state when no paid orders', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeEnvelope()))
    render(withProviders(<PayoutsView />))
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument())
    expect(screen.getByTestId('empty-state')).toHaveTextContent(/no paid orders yet/i)
  })

  it('happy path: payable card + breakdown + current fees', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeEnvelope({
          // BDT 30,000 net to organiser; BDT 50 platform fee; BDT 500 EPS
          pendingPayoutPaisa: '3000000',
          grossRevenuePaisa: '3055000',
          platformFeePaisa: '5000',
          epsFeePaisa: '50000',
          paidOrderCount: 30,
        }),
      ),
    )
    render(withProviders(<PayoutsView />))
    await waitFor(() => expect(screen.getByTestId('payable-card')).toBeInTheDocument())

    // Payable card shows the big number
    expect(screen.getByTestId('payable-card')).toHaveTextContent(/৳ 30,000\.00/)
    expect(screen.getByTestId('payable-card')).toHaveTextContent(/30 paid orders/)

    // Snapshot breakdown
    expect(screen.getByTestId('row-gross')).toHaveTextContent(/৳ 30,550\.00/)
    expect(screen.getByTestId('row-platform-fee')).toHaveTextContent(/৳ 50\.00/)
    expect(screen.getByTestId('row-eps-fee')).toHaveTextContent(/৳ 500\.00/)
    expect(screen.getByTestId('row-net')).toHaveTextContent(/৳ 30,000\.00/)

    // No refund-leak card when refundLeakOrderCount=0
    expect(screen.queryByTestId('refund-leak-card')).not.toBeInTheDocument()
  })
})

describe('PayoutsView — refund leak card conditional', () => {
  it('shows refund-leak card when refundLeakOrderCount > 0', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeEnvelope({
          pendingPayoutPaisa: '100000',
          paidOrderCount: 1,
          refundLeakOrderCount: 2,
          refundLeakPaisa: '205500',
        }),
      ),
    )
    render(withProviders(<PayoutsView />))
    await waitFor(() => expect(screen.getByTestId('refund-leak-card')).toBeInTheDocument())
    expect(screen.getByTestId('refund-leak-card')).toHaveTextContent(/2 orders/)
    expect(screen.getByTestId('refund-leak-card')).toHaveTextContent(/৳ 2,055\.00/)
  })
})

describe('PayoutsView — current fee display reflects bps (NOT per-order snapshot)', () => {
  it('shows the bps from currentFees, not from any snapshotted order field', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeEnvelope({
          // Snapshot says platform fee was 5000 paisa
          platformFeePaisa: '5000',
          paidOrderCount: 1,
          pendingPayoutPaisa: '100000',
          // Current bps wildly different from what those orders were charged
          currentFees: { platformFeeBps: 100, defaultFeeMode: 'absorb', hasOverride: true },
        }),
      ),
    )
    render(withProviders(<PayoutsView />))
    await waitFor(() => expect(screen.getByTestId('row-platform-bps')).toBeInTheDocument())
    // 100 bps = 1.00%
    expect(screen.getByTestId('row-platform-bps')).toHaveTextContent(/1\.00%/)
    expect(screen.getByTestId('row-platform-bps')).toHaveTextContent(/custom rate/i)
    expect(screen.getByTestId('row-fee-mode')).toHaveTextContent(/you absorb/i)
    // Snapshot stays untouched
    expect(screen.getByTestId('row-platform-fee')).toHaveTextContent(/৳ 50\.00/)
  })
})

describe('PayoutsView — error state', () => {
  it('renders error message with role=alert on fetch failure', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    )
    render(withProviders(<PayoutsView />))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/boom/)
  })
})

describe('PayoutsView — accessibility', () => {
  it('axe-clean on happy-path render', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeEnvelope({
          pendingPayoutPaisa: '100000',
          paidOrderCount: 1,
        }),
      ),
    )
    const { container } = render(withProviders(<PayoutsView />))
    await waitFor(() => expect(screen.getByTestId('payable-card')).toBeInTheDocument())
    expect(await axe(container)).toHaveNoViolations()
  })
})

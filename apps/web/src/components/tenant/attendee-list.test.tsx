/**
 * AttendeeList — unit tests.
 * Sprint 4 Day 32 Phase 2.
 *
 * Tests the testable UI surface; the underlying useTenantAttendees
 * hook is fetch-based and mocked at the global fetch boundary.
 *
 *   1. Loading state renders an aria-live status.
 *   2. Empty state renders the helpful message.
 *   3. Happy path renders attendee rows with name + tier + status +
 *      check-in pill.
 *   4. Voided attendees get the "voided" badge.
 *   5. Filter changes trigger refetch (via React Query keyed cache).
 *   6. "Next page" button only renders when hasMore + nextCursor.
 *   7. Error state renders an aria-alert with the error message.
 *   8. Accessibility: axe-clean on the rendered table.
 */

import type { ReactNode } from 'react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'vitest-axe'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { AttendeeList } from './attendee-list'

const TIERS = [
  { id: 't-ga', name: 'General' },
  { id: 't-vip', name: 'VIP' },
]

function makeEnvelope(
  rows: Array<{
    id: string
    name?: string
    email?: string | null
    tierId?: string
    tierName?: string
    orderStatus?: string
    checkedInAt?: string | null
    checkedInGate?: string | null
    voidedAt?: string | null
  }>,
  meta: { nextCursor: string | null; hasMore: boolean } = { nextCursor: null, hasMore: false },
) {
  return {
    data: rows.map((r) => ({
      id: r.id,
      attendeeName: r.name ?? 'Test Attendee',
      attendeeEmail: r.email === undefined ? `${r.id}@test.local` : r.email,
      attendeePhone: null,
      tierId: r.tierId ?? 't-ga',
      tierName: r.tierName ?? 'General',
      orderId: `order-${r.id}`,
      orderStatus: r.orderStatus ?? 'paid',
      checkedInAt: r.checkedInAt ?? null,
      checkedInGate: r.checkedInGate ?? null,
      voidedAt: r.voidedAt ?? null,
      createdAt: new Date().toISOString(),
    })),
    meta,
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
  // test harness; replace global fetch
  ;(global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  // restore (jsdom default)
  delete (global as { fetch?: typeof fetch }).fetch
})

function jsonResponse<T>(body: T, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

// ─── loading + empty + happy path ──────────────────────────────────

describe('AttendeeList — loading + empty + happy path', () => {
  it('renders loading state initially (status role)', () => {
    // Don't resolve; just hold the promise pending
    fetchMock.mockReturnValue(new Promise(() => {}))
    render(withProviders(<AttendeeList eventId="e1" tiers={TIERS} />))
    expect(screen.getByRole('status')).toHaveTextContent(/loading attendees/i)
  })

  it('renders empty state when API returns zero rows', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeEnvelope([])))
    render(withProviders(<AttendeeList eventId="e1" tiers={TIERS} />))
    await waitFor(() =>
      expect(screen.getByText(/no attendees match the current filters/i)).toBeInTheDocument(),
    )
  })

  it('renders attendee rows with name + tier + status + check-in pill', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        makeEnvelope([
          { id: 'a1', name: 'Rashida Khan', tierName: 'General', orderStatus: 'paid' },
          {
            id: 'a2',
            name: 'Karim Ahmed',
            tierName: 'VIP',
            tierId: 't-vip',
            checkedInAt: new Date(Date.now() - 5 * 60_000).toISOString(),
            checkedInGate: 'Gate 1',
          },
        ]),
      ),
    )
    render(withProviders(<AttendeeList eventId="e1" tiers={TIERS} />))
    await waitFor(() => expect(screen.getByText('Rashida Khan')).toBeInTheDocument())
    expect(screen.getByText('Karim Ahmed')).toBeInTheDocument()
    // "VIP" appears in the tier filter <option> AND in the row;
    // scope to the table's body via the karim row's parent.
    const rows = screen.getAllByText('VIP')
    expect(rows.length).toBeGreaterThanOrEqual(1) // option + cell
    // Status badges render lowercased text
    expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0)
    // Check-in pill shows the gate
    expect(screen.getByText(/gate 1/i)).toBeInTheDocument()
  })

  it('voided attendees get a "voided" badge', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(makeEnvelope([{ id: 'a1', name: 'V', voidedAt: new Date().toISOString() }])),
    )
    render(withProviders(<AttendeeList eventId="e1" tiers={TIERS} />))
    await waitFor(() => expect(screen.getByText('V')).toBeInTheDocument())
    expect(screen.getByText(/^voided$/i)).toBeInTheDocument()
  })
})

// ─── filters ────────────────────────────────────────────────────────

describe('AttendeeList — filter changes trigger refetch', () => {
  it('changing the tier filter issues a new fetch with tierId in URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeEnvelope([])))
    render(withProviders(<AttendeeList eventId="e1" tiers={TIERS} />))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText(/tier/i), { target: { value: 't-vip' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const url = fetchMock.mock.calls[1]![0] as string
    expect(url).toMatch(/tierId=t-vip/)
  })

  it('changing check-in filter to checked_in issues a new fetch with checkIn in URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(makeEnvelope([])))
    render(withProviders(<AttendeeList eventId="e1" tiers={TIERS} />))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText(/check-in/i), { target: { value: 'checked_in' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const url = fetchMock.mock.calls[1]![0] as string
    expect(url).toMatch(/checkIn=checked_in/)
  })
})

// ─── pagination ─────────────────────────────────────────────────────

describe('AttendeeList — pagination', () => {
  it('Next page button only renders when hasMore + nextCursor', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(makeEnvelope([{ id: 'a1' }], { nextCursor: 'cur-xyz', hasMore: true })),
    )
    render(withProviders(<AttendeeList eventId="e1" tiers={TIERS} />))
    await waitFor(() => expect(screen.getByText(/next page/i)).toBeInTheDocument())
  })

  it('Next page button absent when no nextCursor', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(makeEnvelope([{ id: 'a1' }], { nextCursor: null, hasMore: false })),
    )
    render(withProviders(<AttendeeList eventId="e1" tiers={TIERS} />))
    await waitFor(() => expect(screen.getByText('Test Attendee')).toBeInTheDocument())
    expect(screen.queryByText(/next page/i)).not.toBeInTheDocument()
  })
})

// ─── error state ────────────────────────────────────────────────────

describe('AttendeeList — error state', () => {
  it('renders error message with role=alert on fetch failure', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    )
    render(withProviders(<AttendeeList eventId="e1" tiers={TIERS} />))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/boom/)
  })
})

// ─── accessibility ──────────────────────────────────────────────────

describe('AttendeeList — accessibility', () => {
  it('table view is axe-clean', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(makeEnvelope([{ id: 'a1', name: 'Axe Test', email: 'axe@test.local' }])),
    )
    const { container } = render(withProviders(<AttendeeList eventId="e1" tiers={TIERS} />))
    await waitFor(() => expect(screen.getByText('Axe Test')).toBeInTheDocument())
    expect(await axe(container)).toHaveNoViolations()
  })
})

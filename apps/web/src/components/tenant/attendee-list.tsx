'use client'

/**
 * AttendeeList — tenant portal attendee list view.
 * Sprint 4 Day 32 Phase 2.
 *
 * Surfaces the attendees for a single event with search + filter +
 * cursor pagination. Mirrors the /admin/kyc queue's plain-<table>
 * convention (no TanStack Table dep installed; consistency over
 * abstraction).
 *
 * Loop-closure with Day 31: the `Checked in` column shows live
 * check-in status pulled from the same attendees table the scanner
 * updates via the Day-31 compare-and-swap.
 *
 * Bilingual per §1.3 R12 — labels render in English; attendee data
 * (names) renders verbatim including Bangla characters.
 */

import { useState } from 'react'

import {
  type AttendeeListFilter,
  type AttendeeListRow,
  type CheckInFilter,
  type OrderStatusFilter,
  useTenantAttendees,
} from '@/hooks/use-tenant-attendees'

interface AttendeeListProps {
  eventId: string
  /** Tier options for the tier filter — fetched server-side by the page. */
  tiers: Array<{ id: string; name: string }>
}

const CHECK_IN_OPTIONS: Array<{ value: CheckInFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'checked_in', label: 'Checked in' },
  { value: 'not_checked_in', label: 'Not checked in' },
]

const ORDER_STATUS_OPTIONS: Array<{ value: OrderStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'awaiting_payment', label: 'Awaiting payment' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
]

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 60_000) return 'just now'
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} d ago`
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'paid' || status === 'completed'
      ? 'bg-[var(--ep-mint)]/15 text-[var(--ep-mint)]'
      : status === 'refunded'
        ? 'bg-[var(--ep-amber)]/15 text-[var(--ep-amber)]'
        : status === 'cancelled' || status === 'failed'
          ? 'bg-[var(--ep-rose)]/15 text-[var(--ep-rose)]'
          : 'bg-[var(--ep-cerulean)]/15 text-[var(--ep-cerulean)]'
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium tracking-wide uppercase ${tone}`}
    >
      {status}
    </span>
  )
}

function CheckInPill({ row }: { row: AttendeeListRow }) {
  if (row.checkedInAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ep-mint)]/15 px-2 py-0.5 text-xs font-medium text-[var(--ep-mint)]">
        ✓ {relativeTime(row.checkedInAt)}
        {row.checkedInGate ? (
          <span className="text-[var(--ep-graphite)]">· {row.checkedInGate}</span>
        ) : null}
      </span>
    )
  }
  return <span className="text-xs text-[var(--ep-graphite)]">—</span>
}

export function AttendeeList({ eventId, tiers }: AttendeeListProps) {
  const [searchInput, setSearchInput] = useState('')
  const [filter, setFilter] = useState<AttendeeListFilter>({
    checkIn: 'all',
    orderStatus: 'all',
    limit: 25,
  })
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const effectiveFilter: AttendeeListFilter = {
    ...filter,
    ...(searchInput.trim().length > 0 ? { search: searchInput.trim() } : {}),
    ...(cursor ? { cursor } : {}),
  }

  const { data, error, isLoading, isFetching } = useTenantAttendees(eventId, effectiveFilter)

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setCursor(undefined) // any filter change resets pagination
  }

  const onFilterChange = (patch: Partial<AttendeeListFilter>) => {
    setCursor(undefined)
    setFilter((prev) => ({ ...prev, ...patch }))
  }

  // CSV export — anchor (not button) so the browser handles the
  // download naturally. Respects the current search + filter.
  function buildExportHref(): string {
    const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
    const base = fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
    const params = new URLSearchParams()
    const searchVal = searchInput.trim()
    if (searchVal.length > 0) params.set('search', searchVal)
    if (filter.tierId) params.set('tierId', filter.tierId)
    if (filter.checkIn && filter.checkIn !== 'all') params.set('checkIn', filter.checkIn)
    if (filter.orderStatus && filter.orderStatus !== 'all') {
      params.set('orderStatus', filter.orderStatus)
    }
    const qs = params.toString()
    return `${base}/api/v1/tenant/events/${eventId}/attendees/export${qs ? `?${qs}` : ''}`
  }

  return (
    <section aria-label="Attendees" className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-[var(--ep-line)] bg-white/40 p-4">
        <form onSubmit={onSearchSubmit} className="min-w-[240px] flex-1">
          <label
            htmlFor="attendee-search"
            className="mb-1 block text-xs font-medium tracking-wide text-[var(--ep-graphite)] uppercase"
          >
            Search
          </label>
          <input
            id="attendee-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Name or email…"
            className="w-full rounded-md border border-[var(--ep-line)] bg-white px-3 py-2 text-sm text-[var(--ep-ink)]"
          />
        </form>

        <div>
          <label
            htmlFor="tier-filter"
            className="mb-1 block text-xs font-medium tracking-wide text-[var(--ep-graphite)] uppercase"
          >
            Tier
          </label>
          <select
            id="tier-filter"
            value={filter.tierId ?? ''}
            onChange={(e) =>
              onFilterChange({ tierId: e.target.value === '' ? undefined : e.target.value })
            }
            className="rounded-md border border-[var(--ep-line)] bg-white px-3 py-2 text-sm text-[var(--ep-ink)]"
          >
            <option value="">All tiers</option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="checkin-filter"
            className="mb-1 block text-xs font-medium tracking-wide text-[var(--ep-graphite)] uppercase"
          >
            Check-in
          </label>
          <select
            id="checkin-filter"
            value={filter.checkIn ?? 'all'}
            onChange={(e) => onFilterChange({ checkIn: e.target.value as CheckInFilter })}
            className="rounded-md border border-[var(--ep-line)] bg-white px-3 py-2 text-sm text-[var(--ep-ink)]"
          >
            {CHECK_IN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="order-status-filter"
            className="mb-1 block text-xs font-medium tracking-wide text-[var(--ep-graphite)] uppercase"
          >
            Order status
          </label>
          <select
            id="order-status-filter"
            value={filter.orderStatus ?? 'all'}
            onChange={(e) => onFilterChange({ orderStatus: e.target.value as OrderStatusFilter })}
            className="rounded-md border border-[var(--ep-line)] bg-white px-3 py-2 text-sm text-[var(--ep-ink)]"
          >
            {ORDER_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Export CSV — respects the active search + filter. Anchor
            (not button) so the browser handles the download naturally;
            the server writes an audit row per Phase-3 decision. */}
        <a
          href={buildExportHref()}
          download
          className="inline-flex items-center gap-2 rounded-md border border-[var(--ep-violet)]/40 bg-[var(--ep-violet)]/10 px-3 py-2 text-sm font-medium text-[var(--ep-violet)] hover:bg-[var(--ep-violet)]/20"
          data-testid="export-csv-link"
        >
          ⬇ Export CSV
        </a>
      </div>

      {/* Results */}
      {isLoading ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border border-[var(--ep-line)] bg-white/40 p-6 text-sm text-[var(--ep-graphite)]"
        >
          Loading attendees…
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--ep-rose)]/40 bg-[var(--ep-rose)]/5 p-6 text-sm text-[var(--ep-rose)]"
        >
          Failed to load attendees: {(error as Error).message}
        </div>
      ) : !data || data.data.length === 0 ? (
        <div className="rounded-2xl border border-[var(--ep-line)] bg-white/40 p-6 text-sm text-[var(--ep-graphite)]">
          No attendees match the current filters.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-[var(--ep-line)] bg-white/40">
            <table className="w-full table-auto border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--ep-line)] text-left text-xs tracking-wide text-[var(--ep-graphite)] uppercase">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Tier</th>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Checked in</th>
                  <th className="px-4 py-3">Registered</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--ep-line)] transition-colors hover:bg-[var(--ep-mist)]"
                  >
                    <td className="px-4 py-3 font-medium text-[var(--ep-ink)]">
                      {row.attendeeName}
                      {row.voidedAt ? (
                        <span className="ml-2 inline-flex rounded-full bg-[var(--ep-rose)]/15 px-2 py-0.5 text-xs text-[var(--ep-rose)]">
                          voided
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-[var(--ep-graphite)]">
                      {row.attendeeEmail ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-[var(--ep-ink)]">{row.tierName}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.orderStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <CheckInPill row={row} />
                    </td>
                    <td className="px-4 py-3 text-[var(--ep-graphite)]">
                      {relativeTime(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.meta.hasMore || cursor ? (
            <div className="flex items-center justify-between text-sm text-[var(--ep-graphite)]">
              <span>
                {data.data.length} shown {isFetching ? '· refreshing…' : ''}
              </span>
              <div className="flex gap-2">
                {cursor ? (
                  <button
                    type="button"
                    onClick={() => setCursor(undefined)}
                    className="rounded-md border border-[var(--ep-line)] bg-white px-3 py-1.5 text-sm text-[var(--ep-ink)] hover:bg-[var(--ep-mist)]"
                  >
                    Back to top
                  </button>
                ) : null}
                {data.meta.hasMore && data.meta.nextCursor ? (
                  <button
                    type="button"
                    onClick={() => setCursor(data.meta.nextCursor!)}
                    className="rounded-md bg-[var(--ep-violet)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--ep-indigo)]"
                  >
                    Next page
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

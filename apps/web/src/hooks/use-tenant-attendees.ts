'use client'

/**
 * useTenantAttendees — TanStack Query hooks for the tenant attendee
 * list (Sprint 4 Day 32 Phase 2).
 *
 * Backed by: GET /api/v1/tenant/events/:eventId/attendees
 *   ?search=...&tierId=...&checkIn=...&orderStatus=...&limit=...&cursor=...
 *
 * The data contains PII (attendee name/email/phone). Cache policy:
 * keep TanStack Query defaults (staleTime 30s, gcTime 5min) — the
 * tenant viewing their own attendees is operational. We do NOT
 * override caches the way the KYC detail hook does (that override
 * existed because super-admin was reading third-party PII).
 *
 * Search inputs are debounced at the UI level, not the hook level.
 */

import { useQuery } from '@tanstack/react-query'

// ─── shared API helpers (mirrors use-admin-kyc.ts) ─────────────────────

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
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

// ─── types ────────────────────────────────────────────────────────────

export type CheckInFilter = 'all' | 'checked_in' | 'not_checked_in'
export type OrderStatusFilter =
  | 'all'
  | 'pending'
  | 'awaiting_payment'
  | 'paid'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'refunded'

export interface AttendeeListRow {
  id: string
  attendeeName: string
  attendeeEmail: string | null
  attendeePhone: string | null
  tierId: string
  tierName: string
  orderId: string
  orderStatus: string
  checkedInAt: string | null
  checkedInGate: string | null
  voidedAt: string | null
  createdAt: string
}

export interface AttendeeListEnvelope {
  data: AttendeeListRow[]
  meta: { nextCursor: string | null; hasMore: boolean }
}

export interface AttendeeListFilter {
  search?: string
  tierId?: string
  checkIn?: CheckInFilter
  orderStatus?: OrderStatusFilter
  limit?: number
  cursor?: string
}

// ─── query keys ────────────────────────────────────────────────────────

export const tenantAttendeeKeys = {
  all: ['tenant', 'attendees'] as const,
  list: (eventId: string, filter?: AttendeeListFilter) =>
    [...tenantAttendeeKeys.all, eventId, 'list', filter ?? {}] as const,
}

// ─── list hook ─────────────────────────────────────────────────────────

export function useTenantAttendees(eventId: string, filter?: AttendeeListFilter) {
  return useQuery({
    queryKey: tenantAttendeeKeys.list(eventId, filter),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filter?.search) params.set('search', filter.search)
      if (filter?.tierId) params.set('tierId', filter.tierId)
      if (filter?.checkIn && filter.checkIn !== 'all') params.set('checkIn', filter.checkIn)
      if (filter?.orderStatus && filter.orderStatus !== 'all') {
        params.set('orderStatus', filter.orderStatus)
      }
      if (filter?.limit) params.set('limit', String(filter.limit))
      if (filter?.cursor) params.set('cursor', filter.cursor)
      const qs = params.toString()
      const url = `${apiBase()}/api/v1/tenant/events/${eventId}/attendees${qs ? `?${qs}` : ''}`
      const res = await fetchWithCreds(url)
      return jsonOrThrow<AttendeeListEnvelope>(res)
    },
    enabled: Boolean(eventId),
  })
}

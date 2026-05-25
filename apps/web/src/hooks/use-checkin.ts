'use client'

/**
 * useCheckIn — TanStack Query hooks for the tenant check-in surface.
 * Sprint 4 Day 31 Phase 2.
 *
 * Backed endpoints (tenant-staff auth via session cookie):
 *
 *   POST /api/v1/tenant/events/:eventId/checkin   {qrCode, gate}
 *   GET  /api/v1/tenant/events/:eventId/checkin/stats
 *
 * The mutation is THIN — it sends the QR + gate, and surfaces the
 * server's discriminated response back to the UI. The UI renders
 * the big-result display per outcome.
 *
 * Cache strategy: the mutation invalidates the stats query on
 * success so the scanner's counter updates immediately. No caching
 * of individual scan results — every scan is a fresh request (we
 * want the latest server state at the door).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

// ─── result types ───────────────────────────────────────────────────

/**
 * Discriminated check-in outcome surfaced to the UI. Mirrors the
 * server's response shapes (200 success + 404/409 error envelopes
 * per §6.2).
 */
export type CheckInOutcome =
  | {
      kind: 'checked_in'
      attendeeId: string
      attendeeName: string
      tierName: string
      checkedInAt: string
    }
  | {
      kind: 'already_checked_in'
      attendeeId: string
      attendeeName: string
      tierName: string
      /** When the ticket was first scanned. */
      originalCheckInAt: string
      originalGate: string | null
    }
  | {
      kind: 'wrong_event'
    }
  | {
      kind: 'invalid'
      reason: 'voided' | 'not_found'
    }
  | {
      kind: 'network_error'
      message: string
    }

interface CheckInSuccessBody {
  data: {
    outcome: 'CHECKED_IN'
    attendee: { id: string; name: string; tier: string }
    checkedInAt: string
  }
}

interface CheckInErrorBody {
  error: {
    code:
      | 'ATTENDEE_ALREADY_CHECKED_IN'
      | 'TICKET_WRONG_EVENT'
      | 'TICKET_INVALID'
      | 'TICKET_VOIDED'
      | string
    message: string
    details?: {
      attendee?: { id: string; name: string; tier: string }
      originalCheckInAt?: string
      originalGate?: string | null
    }
  }
}

// ─── stats ──────────────────────────────────────────────────────────

export interface CheckInStats {
  totalAttendees: number
  checkedInCount: number
  voidedCount: number
}

export function useCheckInStats(eventId: string) {
  return useQuery<CheckInStats>({
    queryKey: ['checkin-stats', eventId],
    queryFn: async () => {
      const res = await fetch(`${apiBase()}/api/v1/tenant/events/${eventId}/checkin/stats`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { data: CheckInStats }
      return body.data
    },
    // Door staff want fast feedback; poll briefly. 5 s feels live without
    // spamming the API.
    refetchInterval: 5000,
  })
}

// ─── scan mutation ──────────────────────────────────────────────────

export interface ScanInput {
  eventId: string
  qrCode: string
  gate?: string | null
}

export function useScan() {
  const qc = useQueryClient()
  return useMutation<CheckInOutcome, never, ScanInput>({
    mutationFn: async (input) => {
      try {
        const res = await fetch(`${apiBase()}/api/v1/tenant/events/${input.eventId}/checkin`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ qrCode: input.qrCode, gate: input.gate ?? null }),
        })

        if (res.status === 200) {
          const body = (await res.json()) as CheckInSuccessBody
          return {
            kind: 'checked_in',
            attendeeId: body.data.attendee.id,
            attendeeName: body.data.attendee.name,
            tierName: body.data.attendee.tier,
            checkedInAt: body.data.checkedInAt,
          }
        }

        const body = (await res.json().catch(() => null)) as CheckInErrorBody | null
        if (body?.error?.code === 'ATTENDEE_ALREADY_CHECKED_IN') {
          return {
            kind: 'already_checked_in',
            attendeeId: body.error.details?.attendee?.id ?? '',
            attendeeName: body.error.details?.attendee?.name ?? '',
            tierName: body.error.details?.attendee?.tier ?? '',
            originalCheckInAt: body.error.details?.originalCheckInAt ?? '',
            originalGate: body.error.details?.originalGate ?? null,
          }
        }
        if (body?.error?.code === 'TICKET_WRONG_EVENT') {
          return { kind: 'wrong_event' }
        }
        if (body?.error?.code === 'TICKET_VOIDED') {
          return { kind: 'invalid', reason: 'voided' }
        }
        // TICKET_INVALID + any other 404
        return { kind: 'invalid', reason: 'not_found' }
      } catch (err) {
        // Network failure — Phase 3 will queue this; Phase 2 surfaces
        // it directly to the door so staff knows the scan didn't reach
        // the server.
        return { kind: 'network_error', message: (err as Error).message }
      }
    },
    onSuccess: (outcome, input) => {
      // Invalidate stats on any outcome that touched server state.
      if (outcome.kind === 'checked_in' || outcome.kind === 'already_checked_in') {
        void qc.invalidateQueries({ queryKey: ['checkin-stats', input.eventId] })
      }
    },
  })
}

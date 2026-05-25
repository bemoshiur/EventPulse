/**
 * Attendee list service — Sprint 4 Day 32 Phase 1.
 *
 * Per §10.2: `GET /api/v1/tenant/events/:id/attendees` with search +
 * filter + cursor pagination. Tenant-scoped read of attendees for a
 * given event the calling tenant owns.
 *
 * ════════════════════════════════════════════════════════════════════
 * Cross-tenant isolation is the LOAD-BEARING security property
 * ════════════════════════════════════════════════════════════════════
 *
 * Attendee data is PII (name, email, phone, optional submission_data).
 * A cross-tenant leak here = a data breach. Two defences in depth:
 *
 *   1. `withTenant(tenantId)` SETs the `app.current_tenant_id` GUC
 *      and runs as `eventpulse_app` (non-superuser, RLS engages).
 *      The `attendees_tenant_select` RLS policy on the table
 *      (migration 0013) restricts SELECT to rows where
 *      `tenant_id = current_setting('app.current_tenant_id')::uuid`.
 *   2. The query joins through `events.tenant_id = $tenantId` AND
 *      filters `events.id = $eventId` — so even if RLS were
 *      momentarily disabled (e.g. accidental withSuperAdmin call),
 *      the application-layer filter still scopes to the caller's
 *      tenant + the specified event.
 *
 * Tested via cross-tenant negative test in the route layer.
 *
 * ════════════════════════════════════════════════════════════════════
 * Schema reality — attendees has NO event_id column
 * ════════════════════════════════════════════════════════════════════
 *
 * `attendees.event_id` does not exist; event scope is reached via
 * `attendees.ticket_tier_id → ticket_tiers.event_id`. Same gotcha as
 * Day 31's check-in service. The join is `attendees ⋈ ticket_tiers
 * ⋈ events` and the event-id + tenant-id predicate goes on `events`
 * (which has its own `events_tenant_select` policy from migration
 * 0011).
 *
 * ════════════════════════════════════════════════════════════════════
 * No per-row audit on list reads (Decision G precedent)
 * ════════════════════════════════════════════════════════════════════
 *
 * The KYC review queue (Item 13 / Decision G) writes per-row audit
 * for the DETAIL view but NOT the list view. Same logic applies here:
 *
 *   - The tenant viewing their own attendees is operational, not
 *     surveillance. They already have this data (they collected it).
 *   - Per-row audit on a paginated list of N attendees would write
 *     N audit rows per page load — noise that drowns out the
 *     interesting state-changing events.
 *
 * The CSV export (Phase 3) IS audited — bulk PII extraction is a
 * discrete operational event worth a trail.
 *
 * ════════════════════════════════════════════════════════════════════
 * Cursor pagination (keyset, not OFFSET)
 * ════════════════════════════════════════════════════════════════════
 *
 * Order is `(createdAt DESC, id DESC)` — newest attendees first
 * (the operational reality: organisers care about the latest
 * registrations). Cursor encodes the last row's `(createdAt, id)`;
 * the next page selects strictly before that. Matches the
 * super-admin/kyc.ts encoder/decoder pattern (battle-tested).
 *
 * Limit is bounded server-side (default 25, max 100) so a hostile
 * client can't ask for 100k rows in one request — that's what the
 * CSV export is for, with its own audit + bulk-extraction policy.
 */

import { and, desc, eq, ilike, isNotNull, isNull, lt, or, type SQL } from 'drizzle-orm'

import { withTenant } from '../../db/client.js'
import { attendees, events, orderItems, orders, ticketTiers } from '../../db/schema/index.js'

// ─── input + output types ───────────────────────────────────────────

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

export interface ListAttendeesInput {
  tenantId: string
  eventId: string
  /** Free-text search across attendee_name + attendee_email. Case-insensitive. */
  search?: string
  /** Filter to a specific ticket tier (uuid). */
  tierId?: string
  /** Filter by check-in state. */
  checkInFilter?: CheckInFilter
  /** Filter by parent order status. */
  orderStatusFilter?: OrderStatusFilter
  /** Page size. Default 25, max 100. */
  limit?: number
  /** Opaque cursor from previous page's `nextCursor`. */
  cursor?: string | null
}

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

export interface ListAttendeesResult {
  rows: AttendeeListRow[]
  nextCursor: string | null
  hasMore: boolean
}

// ─── cursor helpers (mirrors super-admin/kyc.ts pattern) ────────────

interface CursorShape {
  createdAt: Date
  id: string
}

function decodeCursor(cursor?: string | null): CursorShape | null {
  if (!cursor) return null
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8')
    const [iso, id] = decoded.split('|')
    if (!iso || !id) return null
    return { createdAt: new Date(iso), id }
  } catch {
    return null
  }
}

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf-8').toString('base64url')
}

// ─── main query ─────────────────────────────────────────────────────

export async function listEventAttendees(input: ListAttendeesInput): Promise<ListAttendeesResult> {
  const limit = Math.max(1, Math.min(100, input.limit ?? 25))
  const cursor = decodeCursor(input.cursor)

  return withTenant(input.tenantId, async (db) => {
    // Compose WHERE conditions. The event_id + tenant_id predicate on
    // `events` is the load-bearing application-layer filter alongside
    // RLS. Each filter is additive.
    const conditions: SQL[] = [eq(events.id, input.eventId), eq(events.tenantId, input.tenantId)]

    if (input.search && input.search.trim().length > 0) {
      const q = `%${input.search.trim()}%`
      const nameMatch = ilike(attendees.attendeeName, q)
      const emailMatch = ilike(attendees.attendeeEmail, q)
      conditions.push(or(nameMatch, emailMatch)!)
    }

    if (input.tierId) {
      conditions.push(eq(attendees.ticketTierId, input.tierId))
    }

    if (input.checkInFilter === 'checked_in') {
      conditions.push(isNotNull(attendees.checkedInAt))
    } else if (input.checkInFilter === 'not_checked_in') {
      conditions.push(isNull(attendees.checkedInAt))
    }

    if (input.orderStatusFilter && input.orderStatusFilter !== 'all') {
      conditions.push(eq(orders.status, input.orderStatusFilter))
    }

    // Keyset pagination: page-2 selects rows strictly before the cursor
    // in (createdAt DESC, id DESC) order.
    if (cursor) {
      conditions.push(
        or(
          lt(attendees.createdAt, cursor.createdAt),
          and(eq(attendees.createdAt, cursor.createdAt), lt(attendees.id, cursor.id)),
        )!,
      )
    }

    // Fetch limit+1 to detect hasMore without a separate COUNT query.
    const rawRows = await db
      .select({
        id: attendees.id,
        attendeeName: attendees.attendeeName,
        attendeeEmail: attendees.attendeeEmail,
        attendeePhone: attendees.attendeePhone,
        tierId: attendees.ticketTierId,
        tierName: ticketTiers.name,
        orderId: attendees.orderId,
        orderStatus: orders.status,
        checkedInAt: attendees.checkedInAt,
        checkedInGate: attendees.checkedInGate,
        voidedAt: attendees.voidedAt,
        createdAt: attendees.createdAt,
      })
      .from(attendees)
      .innerJoin(orderItems, eq(attendees.orderItemId, orderItems.id))
      .innerJoin(orders, eq(attendees.orderId, orders.id))
      .innerJoin(ticketTiers, eq(attendees.ticketTierId, ticketTiers.id))
      .innerJoin(events, eq(ticketTiers.eventId, events.id))
      .where(and(...conditions))
      .orderBy(desc(attendees.createdAt), desc(attendees.id))
      .limit(limit + 1)

    const hasMore = rawRows.length > limit
    const page = hasMore ? rawRows.slice(0, limit) : rawRows
    const last = page[page.length - 1]
    const nextCursor =
      hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null

    const rows: AttendeeListRow[] = page.map((r) => ({
      id: r.id,
      attendeeName: r.attendeeName,
      attendeeEmail: r.attendeeEmail,
      attendeePhone: r.attendeePhone,
      tierId: r.tierId,
      tierName: r.tierName,
      orderId: r.orderId,
      orderStatus: r.orderStatus,
      checkedInAt: r.checkedInAt ? r.checkedInAt.toISOString() : null,
      checkedInGate: r.checkedInGate,
      voidedAt: r.voidedAt ? r.voidedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }))

    return { rows, nextCursor, hasMore }
  })
}

/**
 * Attendee CSV export service — Sprint 4 Day 32 Phase 3.
 *
 * Per §10.2: `GET /api/v1/tenant/events/:eventId/attendees/export`.
 * Returns a CSV file of the event's attendees, respecting the
 * caller's search + filter (but ignoring pagination — export is
 * unbounded, that's the point).
 *
 * ════════════════════════════════════════════════════════════════════
 * Why bulk PII extraction is audited (vs the list endpoint is not)
 * ════════════════════════════════════════════════════════════════════
 *
 * The list endpoint (Phase 1) does NOT write per-row audit per
 * Decision G precedent (tenant viewing own data is operational, not
 * surveillance). The CSV export IS audited because:
 *
 *   1. It's a discrete operational event — one click, one file,
 *      potentially thousands of PII records leaving the platform.
 *   2. A regulator-facing trail wants "who exported whose attendee
 *      data, when, with what filter applied" available, with no
 *      reconstruction needed.
 *   3. The cost is one audit row per export — operational sweet spot
 *      vs the N-per-page-load cost the list endpoint avoids.
 *
 * Audit captures: actor user, event id, row count, filter snapshot,
 * IP, user-agent. NOT the row data — PII spreading violates §1.3 R5.
 *
 * ════════════════════════════════════════════════════════════════════
 * Cross-tenant isolation
 * ════════════════════════════════════════════════════════════════════
 *
 * Same dual defence as the list endpoint:
 *   1. withTenant() runs as eventpulse_app — RLS engages.
 *   2. Query joins through events.tenant_id = $tenantId AND
 *      events.id = $eventId — app-layer scope alongside RLS.
 *
 * Cross-tenant export attempt → 0 rows + audit row recording the
 * attempt (with row_count=0, which itself is operationally
 * interesting — "tenant X tried to export tenant Y's data" is
 * worth surfacing).
 *
 * ════════════════════════════════════════════════════════════════════
 * CSV correctness (the obvious stuff that's easy to get wrong)
 * ════════════════════════════════════════════════════════════════════
 *
 *   - UTF-8 encoding with BOM (`﻿`) so Excel opens Bangla
 *     attendee names correctly. Without the BOM, Excel-on-Windows
 *     defaults to Windows-1252 and Bangla renders as garbage.
 *   - RFC 4180 escaping: fields containing comma, newline, or
 *     double-quote get wrapped in quotes; embedded quotes doubled.
 *   - Empty fields render as empty (not "null", not "—").
 *   - ISO-8601 timestamps for machine readability.
 */

import { and, asc, eq, ilike, isNotNull, isNull, or, type SQL } from 'drizzle-orm'

import { withTenant } from '../../db/client.js'
import { attendees, events, orderItems, orders, ticketTiers } from '../../db/schema/index.js'
import { writeAttendeesExported } from '../audit/attendees.js'

import type { CheckInFilter, OrderStatusFilter } from './list.js'

// ─── input + output ────────────────────────────────────────────────

export interface ExportAttendeesInput {
  tenantId: string
  eventId: string
  /** The tenant-staff user initiating the export (for the audit row). */
  actorUserId: string
  /** Filter snapshot — same shape as the list endpoint. */
  search?: string
  tierId?: string
  checkInFilter?: CheckInFilter
  orderStatusFilter?: OrderStatusFilter
  /** Forwarded for the audit row. */
  ip: string | null
  userAgent: string | null
}

export interface ExportAttendeesResult {
  csv: string
  rowCount: number
  /** Suggested filename for the Content-Disposition header. */
  filename: string
}

// ─── CSV escaping (RFC 4180 + OWASP formula-injection guard) ───────

const QUOTABLE = /[,"\r\n]/

// Excel + LibreOffice + Sheets evaluate a cell as a formula when the
// first character is `=` `+` `-` `@`, or a leading TAB / CR. Attendee
// names are user-controlled — a malicious attendee could register as
// `=HYPERLINK(...)` and the formula fires when the tenant downloads
// + opens this CSV in Excel (the UTF-8 BOM we emit opts INTO the
// spreadsheet renderer rather than plain text). Same fix as PR #258
// (disbursement-export) — see gotchas.md "CSV exports with UTF-8 BOM
// + user-controlled cells = formula-injection vector" for the rule.
// Per OWASP "Failure to Sanitize CSV Output" / CWE-1236.
const FORMULA_PREFIXES = /^[=+\-@\t\r]/

export function csvEscape(value: string | null | undefined): string {
  if (value == null || value === '') return ''
  const safe = FORMULA_PREFIXES.test(value) ? `'${value}` : value
  if (QUOTABLE.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}

/** Build a CSV row from an array of cell values; never throws on null/undef. */
export function csvRow(cells: Array<string | null | undefined>): string {
  return cells.map(csvEscape).join(',')
}

// ─── main service ──────────────────────────────────────────────────

const CSV_HEADERS = [
  'attendee_id',
  'attendee_name',
  'attendee_email',
  'attendee_phone',
  'ticket_tier',
  'order_status',
  'checked_in_at',
  'checked_in_gate',
  'voided_at',
  'registered_at',
]

export async function exportEventAttendees(
  input: ExportAttendeesInput,
): Promise<ExportAttendeesResult> {
  // SAFETY CAP: even a CSV export is bounded so a hostile or mistaken
  // caller can't bring the server down by exporting a tenant with
  // millions of attendees in one go. MVP cap is 50k rows; if a tenant
  // hits this, the appropriate response is "paginate the export" not
  // "raise the cap unconditionally."
  const HARD_CAP = 50_000

  const result = await withTenant(input.tenantId, async (db) => {
    const conditions: SQL[] = [eq(events.id, input.eventId), eq(events.tenantId, input.tenantId)]

    if (input.search && input.search.trim().length > 0) {
      const q = `%${input.search.trim()}%`
      conditions.push(or(ilike(attendees.attendeeName, q), ilike(attendees.attendeeEmail, q))!)
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

    // Order by registration time ascending — natural reading order
    // for an export ("first 100 registered, then next 100, …").
    const rows = await db
      .select({
        id: attendees.id,
        attendeeName: attendees.attendeeName,
        attendeeEmail: attendees.attendeeEmail,
        attendeePhone: attendees.attendeePhone,
        tierName: ticketTiers.name,
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
      .orderBy(asc(attendees.createdAt), asc(attendees.id))
      .limit(HARD_CAP)

    // Write the audit row INSIDE the tenant tx so its tenant_id passes
    // the audit_logs_tenant_insert RLS check. The row records the
    // export even if rowCount=0 (cross-tenant probe).
    await writeAttendeesExported(db, {
      tenantId: input.tenantId,
      eventId: input.eventId,
      actorUserId: input.actorUserId,
      rowCount: rows.length,
      filter: {
        search: input.search,
        tierId: input.tierId,
        checkIn: input.checkInFilter,
        orderStatus: input.orderStatusFilter,
      },
      ip: input.ip,
      userAgent: input.userAgent,
    })

    return rows
  })

  // BOM + header line + data lines + trailing newline (Excel-friendly)
  const lines: string[] = ['﻿' + CSV_HEADERS.join(',')]
  for (const r of result) {
    lines.push(
      csvRow([
        r.id,
        r.attendeeName,
        r.attendeeEmail,
        r.attendeePhone,
        r.tierName,
        r.orderStatus,
        r.checkedInAt ? r.checkedInAt.toISOString() : null,
        r.checkedInGate,
        r.voidedAt ? r.voidedAt.toISOString() : null,
        r.createdAt.toISOString(),
      ]),
    )
  }
  const csv = lines.join('\r\n') + '\r\n'

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filename = `attendees-${input.eventId}-${stamp}.csv`

  return { csv, rowCount: result.length, filename }
}

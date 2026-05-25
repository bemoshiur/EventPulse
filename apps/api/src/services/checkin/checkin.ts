/**
 * Check-in service — Sprint 4 Day 31 Phase 1.
 *
 * The server-side authority for "is this scanned QR a valid, un-used
 * ticket for this event?" The door's last word.
 *
 * ════════════════════════════════════════════════════════════════════
 * Token verification model — DB existence (NOT signature)
 * ════════════════════════════════════════════════════════════════════
 *
 * Per `decisions.md` "Day 28 architectural choices" Choice A: the QR
 * token is 256-bit cryptographically-random opaque base64url stored
 * in `attendees.qr_code` (UNIQUE). Verification is a single DB
 * lookup — no signature, no key. Forgery resistance comes from
 * entropy alone (~3.7×10^60 yr to brute-force at 1B/sec).
 *
 *   - Found row + not voided + event matches → VALID
 *   - Found row but voided → INVALID
 *   - Found row but wrong event → WRONG_EVENT
 *   - No row → INVALID (treat as "token doesn't exist")
 *
 * ════════════════════════════════════════════════════════════════════
 * Double-entry prevention — atomic conditional UPDATE
 * ════════════════════════════════════════════════════════════════════
 *
 * The core door-correctness invariant: scanning the same valid ticket
 * twice MUST admit exactly ONE person. Re-scan must show
 * ALREADY_CHECKED_IN with the original timestamp, NOT a silent
 * success (door staff needs to SEE the duplicate so they can refuse
 * entry).
 *
 * Implementation: atomic compare-and-swap via a conditional UPDATE
 * with RETURNING:
 *
 *   UPDATE attendees
 *      SET checked_in_at = NOW(),
 *          checked_in_by = $userId,
 *          checked_in_gate = $gate
 *    WHERE qr_code = $token
 *      AND tenant_id = $tenantId  -- defence in depth alongside RLS
 *      AND event_id  = $eventId   -- wrong-event protection
 *      AND voided_at IS NULL      -- voided tickets can't check in
 *      AND checked_in_at IS NULL  -- THE compare-and-swap
 *    RETURNING id, attendee_name, ticket_tier_id, checked_in_at
 *
 * Postgres takes a row lock during UPDATE; two concurrent UPDATEs on
 * the same row serialize. The winner gets a returned row; the loser
 * gets 0 rows. The 0-row path then disambiguates via SELECT:
 *
 *   - Row exists with voided_at NOT NULL → INVALID (voided)
 *   - Row exists with wrong event_id     → WRONG_EVENT
 *   - Row exists with checked_in_at set  → ALREADY_CHECKED_IN
 *   - No row at all                       → INVALID (forged/unknown)
 *
 * The compare-and-swap is the LOAD-BEARING door-policy guarantee.
 * A future "tighten" PR that splits the lookup + update into two
 * statements would re-introduce the race; pinned by tests.
 *
 * ════════════════════════════════════════════════════════════════════
 * Auth + RLS
 * ════════════════════════════════════════════════════════════════════
 *
 * Caller is tenant-staff (any role per §5.4: Owner/Admin/Editor/
 * Scanner all can check-in; Finance cannot — but no `requireRole`
 * middleware exists yet, so MVP uses `requireTenantAuth` only;
 * per-role gate is a Sprint 4+ carry).
 *
 * RLS isolates tenants — `withTenant(tenantId)` ensures the UPDATE
 * only sees rows belonging to this tenant's events. Cross-tenant
 * scanning (staff of tenant A scanning a tenant B token) returns
 * INVALID (the row is invisible to tenant A's RLS-scoped session).
 *
 * ════════════════════════════════════════════════════════════════════
 * Audit
 * ════════════════════════════════════════════════════════════════════
 *
 * Per §1.3 R8 every check-in writes an audit_logs row via
 * `writeAttendeeCheckedIn` (new one-per-domain helper appended to
 * services/audit/attendees.ts). Failed attempts (INVALID,
 * WRONG_EVENT, ALREADY_CHECKED_IN) also audit — door staff sometimes
 * scan tickets at the wrong gate, and we want a trail for ops
 * triage when a customer disputes "I was told my ticket was
 * already used."
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import { withTenant } from '../../db/client.js'
import { attendees, ticketTiers } from '../../db/schema/index.js'
import { logger } from '../../lib/logger.js'

import {
  writeAttendeeCheckInAlready,
  writeAttendeeCheckInRejected,
  writeAttendeeCheckedIn,
} from '../audit/attendees.js'

// ─── outcome types ──────────────────────────────────────────────────

export type CheckInResult =
  | {
      kind: 'checked_in'
      attendeeId: string
      attendeeName: string
      tierName: string
      checkedInAt: Date
    }
  | {
      kind: 'already_checked_in'
      attendeeId: string
      attendeeName: string
      tierName: string
      /** When the ticket was first scanned — door staff sees this. */
      checkedInAt: Date
      checkedInGate: string | null
    }
  | {
      kind: 'invalid'
      reason: 'token_not_found' | 'voided'
    }
  | {
      kind: 'wrong_event'
      /**
       * We DO NOT echo the other event's id (cross-tenant info leak
       * potential); the door staff just needs to know "not this event".
       */
    }

export interface CheckInInput {
  tenantId: string
  eventId: string
  qrCode: string
  /** Authenticated user (the scanner). */
  userId: string
  /** Optional gate label (e.g. "Gate 3"). */
  gate?: string | null
  /** Captured for audit. */
  ip?: string | null
  userAgent?: string | null
}

/**
 * Mark an attendee checked in by scanning their QR. Returns a
 * discriminated outcome; throws ONLY on infra failures (DB
 * connection, etc.) — business outcomes never throw.
 */
export async function checkInAttendee(input: CheckInInput): Promise<CheckInResult> {
  return withTenant(input.tenantId, async (db) => {
    // The `attendees` table has NO `event_id` column — event scope is
    // reachable via `ticket_tier_id → ticket_tiers.event_id`. We use
    // a subquery to gate the UPDATE to tiers of this event.
    //
    // The subquery is in-line in the WHERE so the entire CAS is one
    // statement; row lock semantics still apply per the file-header
    // compare-and-swap design.
    const tierIdsForEvent = db
      .select({ id: ticketTiers.id })
      .from(ticketTiers)
      .where(eq(ticketTiers.eventId, input.eventId))

    // STEP 1 — atomic compare-and-swap. If `checked_in_at IS NULL`
    // AND voided IS NULL AND tier belongs to this event, flip it;
    // RETURNING gives back the row only when we won the race.
    const winner = await db
      .update(attendees)
      .set({
        checkedInAt: new Date(),
        checkedInBy: input.userId,
        checkedInGate: input.gate ?? null,
      })
      .where(
        and(
          eq(attendees.qrCode, input.qrCode),
          inArray(attendees.ticketTierId, tierIdsForEvent),
          isNull(attendees.voidedAt),
          isNull(attendees.checkedInAt),
        ),
      )
      .returning({
        id: attendees.id,
        attendeeName: attendees.attendeeName,
        ticketTierId: attendees.ticketTierId,
        checkedInAt: attendees.checkedInAt,
      })

    if (winner.length > 0) {
      const w = winner[0]!
      // Resolve tier name for the door display.
      const tierRows = await db
        .select({ name: ticketTiers.name })
        .from(ticketTiers)
        .where(eq(ticketTiers.id, w.ticketTierId))
        .limit(1)
      const tierName = tierRows[0]?.name ?? 'Unknown'

      await writeAttendeeCheckedIn(db, {
        attendeeId: w.id,
        tenantId: input.tenantId,
        eventId: input.eventId,
        actorUserId: input.userId,
        gate: input.gate ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      })

      logger.info(
        { attendeeId: w.id, eventId: input.eventId, gate: input.gate ?? null },
        'checkin.success',
      )

      return {
        kind: 'checked_in',
        attendeeId: w.id,
        attendeeName: w.attendeeName,
        tierName,
        // Drizzle returns the value we set — but to be safe use the column.
        checkedInAt: w.checkedInAt ?? new Date(),
      }
    }

    // STEP 2 — disambiguate the 0-row case via SELECT. Per the file
    // header: row could be voided, wrong-event, already-checked-in,
    // or non-existent.
    //
    // NOTE on event scope: this SELECT runs WITHOUT the event-id
    // predicate so we can distinguish "wrong event" from "no token
    // at all". RLS still isolates the tenant; we won't see other
    // tenants' rows. Event-id resolved via join to ticket_tiers
    // (attendees has no direct event_id column).
    const rows = await db
      .select({
        id: attendees.id,
        attendeeName: attendees.attendeeName,
        tierEventId: ticketTiers.eventId,
        voidedAt: attendees.voidedAt,
        checkedInAt: attendees.checkedInAt,
        checkedInGate: attendees.checkedInGate,
        ticketTierId: attendees.ticketTierId,
      })
      .from(attendees)
      .innerJoin(ticketTiers, eq(attendees.ticketTierId, ticketTiers.id))
      .where(eq(attendees.qrCode, input.qrCode))
      .limit(1)

    if (rows.length === 0) {
      // No row in our tenant scope → forged token OR token of another
      // tenant (RLS hides the latter; both surface identically). Both
      // are "invalid" to the door.
      await writeAttendeeCheckInRejected(db, {
        tenantId: input.tenantId,
        eventId: input.eventId,
        reason: 'token_not_found',
        actorUserId: input.userId,
        gate: input.gate ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      })
      logger.warn(
        { eventId: input.eventId, reason: 'token_not_found' },
        'checkin.rejected.token_not_found',
      )
      return { kind: 'invalid', reason: 'token_not_found' }
    }

    const row = rows[0]!

    if (row.voidedAt) {
      await writeAttendeeCheckInRejected(db, {
        attendeeId: row.id,
        tenantId: input.tenantId,
        eventId: input.eventId,
        reason: 'voided',
        actorUserId: input.userId,
        gate: input.gate ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      })
      logger.warn({ attendeeId: row.id, reason: 'voided' }, 'checkin.rejected.voided')
      return { kind: 'invalid', reason: 'voided' }
    }

    if (row.tierEventId !== input.eventId) {
      // Token belongs to the same tenant but a different event of
      // theirs — wrong gate / wrong event setup. Door staff sees
      // "wrong event"; we don't echo the other event id (defence
      // in depth against information leakage).
      await writeAttendeeCheckInRejected(db, {
        attendeeId: row.id,
        tenantId: input.tenantId,
        eventId: input.eventId,
        reason: 'wrong_event',
        actorUserId: input.userId,
        gate: input.gate ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      })
      logger.warn(
        { attendeeId: row.id, scanEventId: input.eventId, actualEventId: row.tierEventId },
        'checkin.rejected.wrong_event',
      )
      return { kind: 'wrong_event' }
    }

    // Only remaining 0-row cause: already_checked_in.
    if (row.checkedInAt) {
      const tierRows = await db
        .select({ name: ticketTiers.name })
        .from(ticketTiers)
        .where(eq(ticketTiers.id, row.ticketTierId))
        .limit(1)
      const tierName = tierRows[0]?.name ?? 'Unknown'

      await writeAttendeeCheckInAlready(db, {
        attendeeId: row.id,
        tenantId: input.tenantId,
        eventId: input.eventId,
        originalCheckInAt: row.checkedInAt,
        actorUserId: input.userId,
        gate: input.gate ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      })

      logger.info(
        { attendeeId: row.id, originalCheckInAt: row.checkedInAt },
        'checkin.already_checked_in',
      )

      return {
        kind: 'already_checked_in',
        attendeeId: row.id,
        attendeeName: row.attendeeName,
        tierName,
        checkedInAt: row.checkedInAt,
        checkedInGate: row.checkedInGate,
      }
    }

    // Defensive — shouldn't reach here if the conditional UPDATE's
    // predicates and the disambiguation SELECT are aligned, but log
    // loudly if it does. Treat as invalid for safety.
    logger.error(
      { attendeeId: row.id, eventId: input.eventId },
      'checkin.unexpected_zero_row_state',
    )
    return { kind: 'invalid', reason: 'token_not_found' }
  })
}

// ─── stats ──────────────────────────────────────────────────────────

export interface CheckInStats {
  totalAttendees: number
  checkedInCount: number
  voidedCount: number
}

/**
 * Per-event check-in stats per §10.2 `GET /tenant/events/:id/checkin/stats`.
 * Cheap aggregate query the scanner dashboard can poll.
 */
export async function getCheckInStats(input: {
  tenantId: string
  eventId: string
}): Promise<CheckInStats> {
  return withTenant(input.tenantId, async (db) => {
    // attendees → ticket_tiers join gates by event_id (attendees has
    // no direct event_id column; see service header).
    const [agg] = await db
      .select({
        total: sql<number>`count(*)::int`,
        checkedIn: sql<number>`count(*) FILTER (WHERE ${attendees.checkedInAt} IS NOT NULL)::int`,
        voided: sql<number>`count(*) FILTER (WHERE ${attendees.voidedAt} IS NOT NULL)::int`,
      })
      .from(attendees)
      .innerJoin(ticketTiers, eq(attendees.ticketTierId, ticketTiers.id))
      .where(eq(ticketTiers.eventId, input.eventId))

    return {
      totalAttendees: agg?.total ?? 0,
      checkedInCount: agg?.checkedIn ?? 0,
      voidedCount: agg?.voided ?? 0,
    }
  })
}

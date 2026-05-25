/**
 * Audit helpers for the attendees domain — Sprint 3 Day 28 Phase 1.
 *
 * Sibling to apps/api/src/services/audit/{orders,events,kyc,...}.ts.
 * One-per-domain audit-helper convention per decisions.md 2026-05-17
 * (reaffirmed 2026-05-18).
 *
 * Today (Day 28):
 *   • writeAttendeesGenerated — fired once per order at the post-paid
 *     attendee-row creation. Captures the count + the tier breakdown;
 *     does NOT capture per-attendee names/emails (those live on the
 *     attendees rows themselves; replicating them across the audit
 *     trail would violate §1.3 R5 by spreading PII unnecessarily).
 *
 * Future helpers:
 *   • writeAttendeeCheckedIn   — scanner check-in (Sprint 4 Day 3-4)
 *   • writeAttendeeVoided      — admin/organiser voids a ticket
 *   • writeAttendeeResent      — buyer requests ticket resend
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { auditLogs } from '../../db/schema/index.js'

type Tx = NodePgDatabase<Record<string, unknown>>

// ─── writeAttendeesGenerated ─────────────────────────────────────────

export interface WriteAttendeesGeneratedInput {
  orderId: string
  tenantId: string
  eventId: string
  attendeeCount: number
  /** Per-tier breakdown: `{ ticketTierId: count }`. Useful for ops triage. */
  tierBreakdown: Record<string, number>
}

/**
 * Audit row for the on-paid attendee-row creation. Fired in the same
 * tx as the attendees INSERT + the `order.attendees_generated`
 * order_events marker. No PII — buyer/attendee names live on the
 * attendees rows.
 */
export async function writeAttendeesGenerated(
  tx: Tx,
  input: WriteAttendeesGeneratedInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: 'system',
    actorId: null,
    action: 'order.attendees_generated',
    entityType: 'order',
    entityId: input.orderId,
    diff: {
      attendee_count: input.attendeeCount,
      tier_breakdown: input.tierBreakdown,
    },
    metadata: { source: 'post_paid_settlement', event_id: input.eventId },
    ip: null,
    userAgent: null,
  })
}

// ─── check-in audit helpers (Day 31 Phase 1) ────────────────────────

export interface WriteAttendeeCheckedInInput {
  attendeeId: string
  tenantId: string
  eventId: string
  /** The scanner — tenant-staff user who scanned the QR. */
  actorUserId: string
  gate: string | null
  ip: string | null
  userAgent: string | null
}

/**
 * Successful check-in audit. Fires in the same tenant-scoped tx as
 * the attendees UPDATE. The actor is the tenant-staff user who
 * scanned (NOT 'system' — a human did this; dispute resolution
 * needs to know who).
 */
export async function writeAttendeeCheckedIn(
  tx: Tx,
  input: WriteAttendeeCheckedInInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: 'tenant_user',
    actorId: input.actorUserId,
    action: 'attendee.checked_in',
    entityType: 'attendee',
    entityId: input.attendeeId,
    diff: { gate: input.gate },
    metadata: { source: 'web_qr_scanner', event_id: input.eventId },
    ip: input.ip,
    userAgent: input.userAgent,
  })
}

export interface WriteAttendeeCheckInAlreadyInput {
  attendeeId: string
  tenantId: string
  eventId: string
  /** Original check-in timestamp — captured in the audit so dispute resolution can match. */
  originalCheckInAt: Date
  actorUserId: string
  gate: string | null
  ip: string | null
  userAgent: string | null
}

/**
 * Re-scan of an already-checked-in attendee. NOT a silent replay —
 * this is auditable because door staff might dispute "but the system
 * said admitted at 7:30 when I scanned at 7:25." We need the trail
 * of every attempt.
 */
export async function writeAttendeeCheckInAlready(
  tx: Tx,
  input: WriteAttendeeCheckInAlreadyInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: 'tenant_user',
    actorId: input.actorUserId,
    action: 'attendee.checkin_already',
    entityType: 'attendee',
    entityId: input.attendeeId,
    diff: {
      gate: input.gate,
      original_check_in_at: input.originalCheckInAt.toISOString(),
    },
    metadata: { source: 'web_qr_scanner', event_id: input.eventId },
    ip: input.ip,
    userAgent: input.userAgent,
  })
}

export interface WriteAttendeeCheckInRejectedInput {
  /** Optional — `null` when the token doesn't exist in our scope. */
  attendeeId?: string
  tenantId: string
  eventId: string
  /** 'token_not_found' | 'voided' | 'wrong_event' */
  reason: 'token_not_found' | 'voided' | 'wrong_event'
  actorUserId: string
  gate: string | null
  ip: string | null
  userAgent: string | null
}

/**
 * Rejected scan audit. Fires for INVALID + WRONG_EVENT outcomes.
 * Token-not-found rejections have no `attendeeId` (we don't know
 * who, because no row matched); the entity_id is null in that case.
 *
 * Audit reason: door staff sometimes scan at the wrong gate or with
 * the wrong event selected in the scanner UI. Auditing failed scans
 * gives ops a forensic trail when an angry customer says "your
 * staff said my ticket was invalid."
 */
export async function writeAttendeeCheckInRejected(
  tx: Tx,
  input: WriteAttendeeCheckInRejectedInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: 'tenant_user',
    actorId: input.actorUserId,
    action: 'attendee.checkin_rejected',
    entityType: 'attendee',
    entityId: input.attendeeId ?? null,
    diff: { gate: input.gate, reason: input.reason },
    metadata: { source: 'web_qr_scanner', event_id: input.eventId },
    ip: input.ip,
    userAgent: input.userAgent,
  })
}

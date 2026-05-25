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

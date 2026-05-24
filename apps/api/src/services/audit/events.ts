/**
 * Audit helpers for the events domain — Sprint 3 Day 23 Workstream 1.
 *
 * Sibling to apps/api/src/services/audit/{kyc,tenant,tenant-subdomain}.ts.
 * One-per-domain audit-helper convention per decisions.md 2026-05-17
 * (reaffirmed 2026-05-18): each helper carries domain-specific TypeScript
 * types on its diff and metadata shapes; a generic helper would lose
 * that type safety. Multiple sibling helpers in the same domain file are
 * fine and expected.
 *
 * What ships today:
 *
 *   • writeEventCreated         — birth audit, fired in the same tx as
 *                                  the INSERT INTO events.
 *   • writeEventUpdated         — PATCH audit. Diff carries the field
 *                                  paths that changed; raw values stay
 *                                  on the events row.
 *   • writeEventTransitioned    — state-machine transition audit per
 *                                  §1.3 R8. Fired AFTER the state-machine
 *                                  validation passes, in the same tx as
 *                                  the UPDATE of events.status. Diff
 *                                  shape mirrors writeKycTransition so
 *                                  future queries like
 *                                    SELECT diff->>'from', diff->>'to'
 *                                    FROM audit_logs
 *                                    WHERE entity_type='event'
 *                                  work without per-entity shape branches.
 *   • writeEventSoftDeleted     — soft-delete audit; sets deleted_at in
 *                                  the same tx. Hard deletes go through
 *                                  withSuperAdmin and write through a
 *                                  separate super-admin-events.ts helper
 *                                  (Phase 2; not in scope today).
 *
 * All four are called inside an active transaction (`tx` from withTenant)
 * so the audit row and the events row mutation commit atomically — a
 * state change without its audit row, or vice-versa, is a regulatory-
 * review failure mode and the transaction boundary is the only thing
 * that prevents it.
 *
 * No-PII rule per §1.3 R5: events don't carry PII directly (titles +
 * descriptions are public copy by definition; venue is public). The
 * audit references the event by id and captures structural metadata
 * (type, status transitions, changed-field paths) only.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { auditLogs } from '../../db/schema/index.js'
import type { EventStatus } from '../../domain/event-state-machine.js'

/**
 * Subset of `audit_logs.actor_type` (§9.10) that event-domain writers
 * emit. Phase 1 events ship `tenant_user` only; Phase 2's super-admin
 * unpublish action (AUP triage queue per §21.5) will use `super_admin`
 * via its own helper in super-admin-events.ts.
 */
export type EventAuditActorRole = 'tenant_user' | 'super_admin'

export type EventType =
  | 'concert'
  | 'alumni'
  | 'standup'
  | 'conference'
  | 'workshop'
  | 'community'
  | 'sports'
  | 'other'

type Tx = NodePgDatabase<Record<string, unknown>>

// ─── writeEventCreated ────────────────────────────────────────────────

export interface WriteEventCreatedInput {
  eventId: string
  tenantId: string
  actorUserId: string
  actorRole: EventAuditActorRole
  eventType: EventType
  /** Initial status — always 'draft' at MVP, but kept explicit for
   *  forward-compat if the create endpoint ever takes a draft-or-published
   *  flag. */
  initialStatus: EventStatus
  ip?: string | null
  userAgent?: string | null
}

export async function writeEventCreated(tx: Tx, input: WriteEventCreatedInput): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: input.actorRole,
    actorId: input.actorUserId,
    action: 'event.created',
    entityType: 'event',
    entityId: input.eventId,
    diff: {
      event_type: input.eventType,
      initial_status: input.initialStatus,
    },
    metadata: { actor_role: input.actorRole },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}

// ─── writeEventUpdated ────────────────────────────────────────────────

export interface WriteEventUpdatedInput {
  eventId: string
  tenantId: string
  actorUserId: string
  actorRole: EventAuditActorRole
  /** Field paths that changed in this PATCH (e.g. ['title', 'venue',
   *  'starts_at']). Values NOT included — they live on the events row. */
  changedFields: readonly string[]
  ip?: string | null
  userAgent?: string | null
}

export async function writeEventUpdated(tx: Tx, input: WriteEventUpdatedInput): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: input.actorRole,
    actorId: input.actorUserId,
    action: 'event.updated',
    entityType: 'event',
    entityId: input.eventId,
    diff: {
      changed_fields: [...input.changedFields],
    },
    metadata: { actor_role: input.actorRole },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}

// ─── writeEventTransitioned ───────────────────────────────────────────

export interface WriteEventTransitionedInput {
  eventId: string
  tenantId: string
  actorUserId: string
  actorRole: EventAuditActorRole
  fromState: EventStatus
  toState: EventStatus
  /** Optional reason — used when archiving or unpublishing for
   *  forensic context. Tenants are not required to provide one. */
  reason?: string | null
  ip?: string | null
  userAgent?: string | null
}

export async function writeEventTransitioned(
  tx: Tx,
  input: WriteEventTransitionedInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: input.actorRole,
    actorId: input.actorUserId,
    action: 'event.transition',
    entityType: 'event',
    entityId: input.eventId,
    diff: {
      from: input.fromState,
      to: input.toState,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    metadata: { actor_role: input.actorRole },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}

// ─── writeEventSoftDeleted ────────────────────────────────────────────

export interface WriteEventSoftDeletedInput {
  eventId: string
  tenantId: string
  actorUserId: string
  actorRole: EventAuditActorRole
  /** Snapshot of the event's status at delete time — distinguishes
   *  "deleted a draft" from "deleted a live event" without joining
   *  to a stale events.status (the row stays around with deleted_at
   *  set; status may shift in a later restore). */
  statusAtDelete: EventStatus
  ip?: string | null
  userAgent?: string | null
}

export async function writeEventSoftDeleted(
  tx: Tx,
  input: WriteEventSoftDeletedInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: input.actorRole,
    actorId: input.actorUserId,
    action: 'event.soft_deleted',
    entityType: 'event',
    entityId: input.eventId,
    diff: {
      status_at_delete: input.statusAtDelete,
    },
    metadata: { actor_role: input.actorRole },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}

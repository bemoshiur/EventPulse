/**
 * Audit helpers for the ticket-tiers domain — Sprint 3 Day 25.
 *
 * Sibling to apps/api/src/services/audit/{events,kyc,tenant,
 * tenant-subdomain,legal,fee-config}.ts. One-per-domain audit-helper
 * convention per decisions.md 2026-05-17 (reaffirmed 2026-05-18): each
 * helper carries domain-specific TypeScript types on its diff and
 * metadata shapes; a generic helper would lose that type safety.
 *
 * What ships today:
 *
 *   • writeTicketTierCreated   — birth audit, fired in the same tx as
 *                                 the INSERT INTO ticket_tiers.
 *   • writeTicketTierUpdated   — PATCH audit. Diff carries the field
 *                                 paths that changed; raw values stay
 *                                 on the ticket_tiers row (consistent
 *                                 with writeEventUpdated shape).
 *   • writeTicketTierArchived  — archive audit; sets archived_at in
 *                                 the same tx. Distinct action label
 *                                 from a hypothetical hard-delete (no
 *                                 hard delete path exists for tiers in
 *                                 the application layer — orders FK
 *                                 to tiers, so hard-delete would
 *                                 cascade-fail; tenants use archive).
 *
 * All three are called inside an active transaction (`tx` from
 * withTenant) so the audit row and the ticket_tiers row mutation
 * commit atomically — a state change without its audit row is a
 * regulatory-review failure mode per §1.3 R8.
 *
 * No-PII rule per §1.3 R5: tier rows don't carry PII — name +
 * description are public copy (rendered on the public event page).
 * The audit references the tier by id and captures structural
 * metadata (price_paisa for revenue reconciliation, capacity for
 * audit-of-changes, changed-field paths) only.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { auditLogs } from '../../db/schema/index.js'

/**
 * Subset of `audit_logs.actor_type` (§9.10) that tier-domain writers
 * emit. Phase 1 ships `tenant_user` only; Phase 2's super-admin
 * tier-archive flow (AUP triage outcomes, e.g.) would use
 * `super_admin` via its own super-admin-ticket-tiers.ts helper.
 */
export type TicketTierAuditActorRole = 'tenant_user' | 'super_admin'

type Tx = NodePgDatabase<Record<string, unknown>>

// ─── writeTicketTierCreated ──────────────────────────────────────────

export interface WriteTicketTierCreatedInput {
  tierId: string
  eventId: string
  tenantId: string
  actorUserId: string
  actorRole: TicketTierAuditActorRole
  /** Tier name — public copy, safe to log per §1.3 R5. */
  name: string
  /** Price in paisa per §1.3 R2. Serialised as string in jsonb because
   *  Postgres jsonb doesn't preserve bigint precision; downstream
   *  consumers parse back to bigint. */
  pricePaisa: bigint
  capacity: number
  isComplimentary: boolean
  ip?: string | null
  userAgent?: string | null
}

export async function writeTicketTierCreated(
  tx: Tx,
  input: WriteTicketTierCreatedInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: input.actorRole,
    actorId: input.actorUserId,
    action: 'ticket_tier.created',
    entityType: 'ticket_tier',
    entityId: input.tierId,
    diff: {
      event_id: input.eventId,
      name: input.name,
      price_paisa: input.pricePaisa.toString(),
      capacity: input.capacity,
      is_complimentary: input.isComplimentary,
    },
    metadata: { actor_role: input.actorRole, event_id: input.eventId },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}

// ─── writeTicketTierUpdated ──────────────────────────────────────────

export interface WriteTicketTierUpdatedInput {
  tierId: string
  eventId: string
  tenantId: string
  actorUserId: string
  actorRole: TicketTierAuditActorRole
  /** Field paths that changed in this PATCH. Values NOT included —
   *  they live on the ticket_tiers row, accessible via point-in-time
   *  query if forensic context demands it. */
  changedFields: readonly string[]
  ip?: string | null
  userAgent?: string | null
}

export async function writeTicketTierUpdated(
  tx: Tx,
  input: WriteTicketTierUpdatedInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: input.actorRole,
    actorId: input.actorUserId,
    action: 'ticket_tier.updated',
    entityType: 'ticket_tier',
    entityId: input.tierId,
    diff: { changed_fields: [...input.changedFields] },
    metadata: { actor_role: input.actorRole, event_id: input.eventId },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}

// ─── writeTicketTierArchived ─────────────────────────────────────────

export interface WriteTicketTierArchivedInput {
  tierId: string
  eventId: string
  tenantId: string
  actorUserId: string
  actorRole: TicketTierAuditActorRole
  /** Sold count at archive time — useful in reconciliation: a tier
   *  archived with sold > 0 has live orders attached. */
  soldAtArchive: number
  /** Optional reason from the tenant — captured verbatim, max length
   *  enforced upstream by the API layer. */
  reason?: string | null
  ip?: string | null
  userAgent?: string | null
}

export async function writeTicketTierArchived(
  tx: Tx,
  input: WriteTicketTierArchivedInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: input.actorRole,
    actorId: input.actorUserId,
    action: 'ticket_tier.archived',
    entityType: 'ticket_tier',
    entityId: input.tierId,
    diff: {
      sold_at_archive: input.soldAtArchive,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    metadata: { actor_role: input.actorRole, event_id: input.eventId },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}

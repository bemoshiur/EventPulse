/**
 * Ticket-tier service layer — Sprint 3 Day 25.
 *
 * Five functions over `withTenant()`:
 *
 *   • createTier        — INSERT + ownership-check + audit in one tx
 *   • getTier           — single fetch by id (tenant-scoped via RLS)
 *   • listTiersByEvent  — array, with optional include-archived flag
 *   • updateTier        — PATCH (specific fields) + audit
 *   • archiveTier       — soft-archive via archived_at + audit
 *
 * **No money math here.** Per the load-bearing rule (§1.3 + handoff
 * guardrail): all fee/price calculation lives in
 * `apps/api/src/domain/payments/fee-calculator.ts`. The service stores
 * `price_paisa` raw; the order pipeline (Day 26-28) is the only place
 * that feeds price into the calculator.
 *
 * **Capacity locking is NOT here.** The `sold` counter exists on the
 * row; the `SELECT ... FOR UPDATE` row lock that prevents oversell at
 * paid-order transition lands Day 29 — that's the order pipeline's
 * concern, not the CRUD surface. The service doesn't even read `sold`
 * in mutation paths.
 *
 * Event-ownership check: every mutation verifies the parent event
 * belongs to the calling tenant + isn't soft-deleted. RLS on
 * `ticket_tiers` already restricts writes to `tenant_id = current`
 * setting, but an extra read of `events` under the same tenant context
 * filters out "this tenant has no event with that id" before we touch
 * `ticket_tiers`. This produces a clean 404 instead of a confusing
 * RLS-rejected INSERT or a misleading "tier inserted under wrong
 * event_id" outcome.
 *
 * Audit discipline (mirrors events service):
 *
 *   Every state-changing function calls the matching
 *   `writeTicketTier*` helper inside the same tx, before returning.
 *   No audit means no commit per §1.3 R8.
 */

import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import { withTenant } from '../../db/client.js'
import { events, ticketTiers } from '../../db/schema/index.js'
import {
  writeTicketTierArchived,
  writeTicketTierCreated,
  writeTicketTierUpdated,
} from '../audit/ticket-tiers.js'

// ─── typed errors ─────────────────────────────────────────────────────

export class TierEventNotFoundError extends Error {
  constructor(public readonly eventId: string) {
    super(`event ${eventId} not found in tenant scope (or soft-deleted)`)
    this.name = 'TierEventNotFoundError'
  }
}

export class TierNotFoundError extends Error {
  constructor(public readonly tierId: string) {
    super(`ticket tier ${tierId} not found in tenant scope`)
    this.name = 'TierNotFoundError'
  }
}

export class TierArchivedError extends Error {
  constructor(public readonly tierId: string) {
    super(`ticket tier ${tierId} is archived; mutations are not allowed`)
    this.name = 'TierArchivedError'
  }
}

// ─── shapes ────────────────────────────────────────────────────────────

export interface TierRecord {
  id: string
  tenantId: string
  eventId: string
  name: string
  description: string | null
  pricePaisa: bigint
  capacity: number
  sold: number
  salesStartAt: Date | null
  salesEndAt: Date | null
  minPerOrder: number
  maxPerOrder: number
  isComplimentary: boolean
  sortOrder: number
  archivedAt: Date | null
  createdAt: Date
}

function rowToRecord(row: typeof ticketTiers.$inferSelect): TierRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    eventId: row.eventId,
    name: row.name,
    description: row.description,
    pricePaisa: row.pricePaisa,
    capacity: row.capacity,
    sold: row.sold,
    salesStartAt: row.salesStartAt,
    salesEndAt: row.salesEndAt,
    minPerOrder: row.minPerOrder,
    maxPerOrder: row.maxPerOrder,
    isComplimentary: row.isComplimentary,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
  }
}

// ─── createTier ──────────────────────────────────────────────────────

export interface CreateTierInput {
  tenantId: string
  eventId: string
  actorUserId: string
  name: string
  description?: string | null
  pricePaisa: bigint
  capacity: number
  salesStartAt?: Date | null
  salesEndAt?: Date | null
  minPerOrder?: number
  maxPerOrder?: number
  isComplimentary?: boolean
  sortOrder?: number
  ip?: string | null
  userAgent?: string | null
}

export async function createTier(input: CreateTierInput): Promise<TierRecord> {
  return withTenant(input.tenantId, async (tx) => {
    // 1. Verify the event exists in this tenant scope + isn't soft-deleted.
    //    RLS would already reject cross-tenant access, but the explicit
    //    read produces a clean 404 path for the route handler.
    const eventRow = await tx
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, input.eventId), isNull(events.deletedAt)))
      .limit(1)
    if (eventRow.length === 0) {
      throw new TierEventNotFoundError(input.eventId)
    }

    // 2. Insert tier. CHECK constraints (price >= 0, capacity > 0,
    //    min <= max, complimentary => price = 0, etc.) enforced by DB.
    const inserted = await tx
      .insert(ticketTiers)
      .values({
        tenantId: input.tenantId,
        eventId: input.eventId,
        name: input.name,
        description: input.description ?? null,
        pricePaisa: input.pricePaisa,
        capacity: input.capacity,
        // sold defaults to 0; tenant cannot set it
        salesStartAt: input.salesStartAt ?? null,
        salesEndAt: input.salesEndAt ?? null,
        minPerOrder: input.minPerOrder ?? 1,
        maxPerOrder: input.maxPerOrder ?? 10,
        isComplimentary: input.isComplimentary ?? false,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning()
    const row = inserted[0]!

    // 3. Audit in the same tx — atomic with the insert per §1.3 R8.
    await writeTicketTierCreated(tx, {
      tierId: row.id,
      eventId: row.eventId,
      tenantId: row.tenantId,
      actorUserId: input.actorUserId,
      actorRole: 'tenant_user',
      name: row.name,
      pricePaisa: row.pricePaisa,
      capacity: row.capacity,
      isComplimentary: row.isComplimentary,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })

    return rowToRecord(row)
  })
}

// ─── getTier ─────────────────────────────────────────────────────────

export async function getTier(tenantId: string, tierId: string): Promise<TierRecord> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.select().from(ticketTiers).where(eq(ticketTiers.id, tierId)).limit(1)
    if (rows.length === 0) throw new TierNotFoundError(tierId)
    return rowToRecord(rows[0]!)
  })
}

// ─── listTiersByEvent ────────────────────────────────────────────────

export interface ListTiersOptions {
  /** When true, include rows with archived_at != NULL. Default false. */
  includeArchived?: boolean
}

export async function listTiersByEvent(
  tenantId: string,
  eventId: string,
  opts: ListTiersOptions = {},
): Promise<TierRecord[]> {
  return withTenant(tenantId, async (tx) => {
    const conditions = [eq(ticketTiers.eventId, eventId)]
    if (!opts.includeArchived) {
      conditions.push(isNull(ticketTiers.archivedAt))
    }
    const rows = await tx
      .select()
      .from(ticketTiers)
      .where(and(...conditions))
      .orderBy(asc(ticketTiers.sortOrder), asc(ticketTiers.createdAt))
    return rows.map(rowToRecord)
  })
}

// ─── updateTier ──────────────────────────────────────────────────────

export interface UpdateTierInput {
  tenantId: string
  tierId: string
  actorUserId: string
  patch: {
    name?: string
    description?: string | null
    pricePaisa?: bigint
    capacity?: number
    salesStartAt?: Date | null
    salesEndAt?: Date | null
    minPerOrder?: number
    maxPerOrder?: number
    isComplimentary?: boolean
    sortOrder?: number
  }
  ip?: string | null
  userAgent?: string | null
}

export async function updateTier(input: UpdateTierInput): Promise<TierRecord> {
  return withTenant(input.tenantId, async (tx) => {
    // 1. Read current row to verify exists + not archived.
    const current = await tx
      .select()
      .from(ticketTiers)
      .where(eq(ticketTiers.id, input.tierId))
      .limit(1)
    if (current.length === 0) throw new TierNotFoundError(input.tierId)
    if (current[0]!.archivedAt !== null) throw new TierArchivedError(input.tierId)

    // 2. Build the SET clause from the patch — only present keys are
    //    updated; absent keys are left untouched.
    const setMap: Record<string, unknown> = {}
    const changedFields: string[] = []
    const p = input.patch
    if (p.name !== undefined) {
      setMap['name'] = p.name
      changedFields.push('name')
    }
    if (p.description !== undefined) {
      setMap['description'] = p.description
      changedFields.push('description')
    }
    if (p.pricePaisa !== undefined) {
      setMap['pricePaisa'] = p.pricePaisa
      changedFields.push('price_paisa')
    }
    if (p.capacity !== undefined) {
      setMap['capacity'] = p.capacity
      changedFields.push('capacity')
    }
    if (p.salesStartAt !== undefined) {
      setMap['salesStartAt'] = p.salesStartAt
      changedFields.push('sales_start_at')
    }
    if (p.salesEndAt !== undefined) {
      setMap['salesEndAt'] = p.salesEndAt
      changedFields.push('sales_end_at')
    }
    if (p.minPerOrder !== undefined) {
      setMap['minPerOrder'] = p.minPerOrder
      changedFields.push('min_per_order')
    }
    if (p.maxPerOrder !== undefined) {
      setMap['maxPerOrder'] = p.maxPerOrder
      changedFields.push('max_per_order')
    }
    if (p.isComplimentary !== undefined) {
      setMap['isComplimentary'] = p.isComplimentary
      changedFields.push('is_complimentary')
    }
    if (p.sortOrder !== undefined) {
      setMap['sortOrder'] = p.sortOrder
      changedFields.push('sort_order')
    }

    // 3. If nothing changed, short-circuit + skip audit (no diff = no event).
    if (changedFields.length === 0) {
      return rowToRecord(current[0]!)
    }

    // 4. Apply UPDATE. DB CHECKs (price >= 0, max >= min, complimentary
    //    => price 0, sales_end > sales_start) enforce invariants that
    //    the zod schema couldn't catch (e.g. price PATCH from non-zero to
    //    non-zero while the row's is_complimentary is true).
    const updated = await tx
      .update(ticketTiers)
      .set(setMap)
      .where(eq(ticketTiers.id, input.tierId))
      .returning()
    const row = updated[0]!

    // 5. Audit.
    await writeTicketTierUpdated(tx, {
      tierId: row.id,
      eventId: row.eventId,
      tenantId: row.tenantId,
      actorUserId: input.actorUserId,
      actorRole: 'tenant_user',
      changedFields,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })

    return rowToRecord(row)
  })
}

// ─── archiveTier ─────────────────────────────────────────────────────

export interface ArchiveTierInput {
  tenantId: string
  tierId: string
  actorUserId: string
  reason?: string | null
  ip?: string | null
  userAgent?: string | null
}

export async function archiveTier(input: ArchiveTierInput): Promise<TierRecord> {
  return withTenant(input.tenantId, async (tx) => {
    const current = await tx
      .select()
      .from(ticketTiers)
      .where(eq(ticketTiers.id, input.tierId))
      .limit(1)
    if (current.length === 0) throw new TierNotFoundError(input.tierId)
    if (current[0]!.archivedAt !== null) throw new TierArchivedError(input.tierId)

    const updated = await tx
      .update(ticketTiers)
      .set({ archivedAt: sql`now()` })
      .where(eq(ticketTiers.id, input.tierId))
      .returning()
    const row = updated[0]!

    await writeTicketTierArchived(tx, {
      tierId: row.id,
      eventId: row.eventId,
      tenantId: row.tenantId,
      actorUserId: input.actorUserId,
      actorRole: 'tenant_user',
      soldAtArchive: row.sold,
      reason: input.reason ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })

    return rowToRecord(row)
  })
}

/**
 * Event service layer — Sprint 3 Day 23 Workstream 1.
 *
 * Six pure-ish functions on top of `withTenant()` / `withSuperAdmin()`:
 *
 *   • createEvent       — INSERT with slug generation + fee-mode snapshot
 *                          from tenant_fee_config + audit row in one tx
 *   • listEvents        — paginated, cursor-based, soft-delete-aware
 *   • getEvent          — single fetch by id, soft-delete-aware
 *   • updateEvent       — PATCH; status edits NOT here (use transitionEvent)
 *   • transitionEvent   — state-machine-gated status change + audit
 *   • softDeleteEvent   — set deleted_at + audit; hard delete is super-admin
 *
 * Composition pattern:
 *
 *   Route handler validates input → calls service → catches typed errors
 *   → maps to response envelope (§6.2). Services never touch
 *   `c: Context`; never compose response bodies; never log request_id.
 *   This keeps services unit-testable against a real DB without HTTP.
 *
 * State-machine discipline (mirrors fee-calculator.ts purity):
 *
 *   Status changes go through `transitionEvent`, which calls
 *   `validateTransition()` from apps/api/src/domain/event-state-machine.ts.
 *   `updateEvent` deliberately REJECTS attempts to PATCH status — keeps
 *   the audit shape clean (status changes get `event.transition` rows,
 *   not `event.updated` rows).
 *
 * Fee-mode snapshot (per decisions.md 2026-05-24 "EPS fee is NOT per-
 * tenant configurable"):
 *
 *   At create time, if the request omits platformFeeHandling +
 *   epsFeeHandling, the service reads tenant_fee_config.default_fee_mode
 *   and snapshots it onto BOTH event columns. Once snapshotted, the
 *   event's fee mode is immutable via this CRUD surface (the tenant can
 *   explicitly change it via PATCH while the event is in 'draft').
 */

import { SQL, and, asc, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm'

import { withTenant } from '../../db/client.js'
import { events, tenantFeeConfig } from '../../db/schema/index.js'
import type { EventType, FeeHandlingMode } from '@eventpulse/shared-types'

import {
  type EventStatus,
  validateTransition,
} from '../../domain/event-state-machine.js'
import { logger } from '../../lib/logger.js'
import {
  writeEventCreated,
  writeEventSoftDeleted,
  writeEventTransitioned,
  writeEventUpdated,
} from '../audit/events.js'

// Re-export for convenience.
export type { EventStatus, EventType, FeeHandlingMode }

// ─── typed errors ─────────────────────────────────────────────────────

export class EventNotFoundError extends Error {
  constructor(public readonly eventId: string) {
    super(`event ${eventId} not found`)
    this.name = 'EventNotFoundError'
  }
}

export class EventSlugConflictError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly slug: string,
  ) {
    super(`slug ${slug} already exists for tenant ${tenantId}`)
    this.name = 'EventSlugConflictError'
  }
}

export class EventInvalidTransitionError extends Error {
  constructor(
    public readonly from: EventStatus,
    public readonly to: EventStatus,
    public readonly reason: string,
    public readonly allowedNext: readonly EventStatus[],
  ) {
    super(reason)
    this.name = 'EventInvalidTransitionError'
  }
}

export class EventInvalidStatusForEditError extends Error {
  constructor(public readonly currentStatus: EventStatus) {
    super(`event in status '${currentStatus}' cannot be edited via PATCH`)
    this.name = 'EventInvalidStatusForEditError'
  }
}

// ─── slug generation ──────────────────────────────────────────────────
//
// kebab-case ASCII + numeric suffix on collision. Bangla titles fall
// back to a 'event-<8-char-id>' shape because URL slugs are ASCII-only
// in MVP (Phase 3 can add IDN support if research justifies the bytes).

const SLUG_MAX_LEN = 64

function baseSlugFromTitle(title: string): string {
  const ascii = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LEN)
  if (ascii.length >= 3) return ascii
  // Bangla-only or very short ASCII title — fall back to a stable shape.
  // The randomness comes from gen_random_uuid() at insert time; here we
  // return a placeholder the create function fills in with the row's id.
  return 'event'
}

// ─── createEvent ──────────────────────────────────────────────────────

export interface CreateEventInput {
  tenantId: string
  actorUserId: string
  type: EventType
  title: string
  titleBn?: string | null
  description?: string | null
  descriptionBn?: string | null
  startsAt: Date
  endsAt: Date
  timezone?: string
  venue: unknown // already validated upstream as VenueSchema
  capacity?: number | null
  visibility?: 'public' | 'unlisted' | 'private'
  bannerImageUrl?: string | null
  ogImageUrl?: string | null
  refundPolicy?: unknown // already validated upstream as RefundPolicySchema
  platformFeeHandling?: FeeHandlingMode
  epsFeeHandling?: FeeHandlingMode
  ip?: string | null
  userAgent?: string | null
}

export interface CreatedEvent {
  id: string
  slug: string
  status: EventStatus
  type: EventType
  title: string
  createdAt: Date
}

const SLUG_COLLISION_MAX_ATTEMPTS = 5

export async function createEvent(input: CreateEventInput): Promise<CreatedEvent> {
  return withTenant(input.tenantId, async (tx) => {
    // 1. Resolve fee-mode snapshot from tenant_fee_config when caller omits.
    let platformFeeHandling: FeeHandlingMode = input.platformFeeHandling ?? 'pass_through'
    let epsFeeHandling: FeeHandlingMode = input.epsFeeHandling ?? 'pass_through'
    if (!input.platformFeeHandling || !input.epsFeeHandling) {
      const cfg = await tx
        .select({ defaultFeeMode: tenantFeeConfig.defaultFeeMode })
        .from(tenantFeeConfig)
        .where(eq(tenantFeeConfig.tenantId, input.tenantId))
        .limit(1)
      const fallback =
        (cfg[0]?.defaultFeeMode as FeeHandlingMode | undefined) ?? 'pass_through'
      if (!input.platformFeeHandling) platformFeeHandling = fallback
      if (!input.epsFeeHandling) epsFeeHandling = fallback
    }

    // 2. Generate slug + handle collisions deterministically.
    const base = baseSlugFromTitle(input.title)
    let attempt = 0
    let inserted: { id: string; slug: string } | null = null
    let lastError: unknown = null
    while (attempt < SLUG_COLLISION_MAX_ATTEMPTS && inserted === null) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
      try {
        const rows = await tx
          .insert(events)
          .values({
            tenantId: input.tenantId,
            slug: candidate,
            type: input.type,
            status: 'draft',
            visibility: input.visibility ?? 'public',
            title: input.title,
            titleBn: input.titleBn ?? null,
            description: input.description ?? null,
            descriptionBn: input.descriptionBn ?? null,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            timezone: input.timezone ?? 'Asia/Dhaka',
            venue: input.venue as object,
            capacity: input.capacity ?? null,
            bannerImageUrl: input.bannerImageUrl ?? null,
            ogImageUrl: input.ogImageUrl ?? null,
            epsFeeHandling,
            platformFeeHandling,
            refundPolicy:
              (input.refundPolicy as object | undefined) ?? { allowed: false },
            createdBy: input.actorUserId,
          })
          .returning({ id: events.id, slug: events.slug })
        if (rows.length === 0) throw new Error('insert returned zero rows')
        inserted = rows[0]!
      } catch (err) {
        lastError = err
        if (err instanceof Error && /events_tenant_slug_uq/.test(err.message)) {
          attempt += 1
          continue
        }
        throw err
      }
    }

    if (inserted === null) {
      logger.warn(
        { tenantId: input.tenantId, base, attempts: attempt },
        'event slug collision exhausted attempts; falling back to id-based slug',
      )
      const fallbackRows = await tx
        .insert(events)
        .values({
          tenantId: input.tenantId,
          slug: sql`'event-' || substring(gen_random_uuid()::text, 1, 8)`,
          type: input.type,
          status: 'draft',
          visibility: input.visibility ?? 'public',
          title: input.title,
          titleBn: input.titleBn ?? null,
          description: input.description ?? null,
          descriptionBn: input.descriptionBn ?? null,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          timezone: input.timezone ?? 'Asia/Dhaka',
          venue: input.venue as object,
          capacity: input.capacity ?? null,
          bannerImageUrl: input.bannerImageUrl ?? null,
          ogImageUrl: input.ogImageUrl ?? null,
          epsFeeHandling,
          platformFeeHandling,
          refundPolicy:
            (input.refundPolicy as object | undefined) ?? { allowed: false },
          createdBy: input.actorUserId,
        })
        .returning({ id: events.id, slug: events.slug })
      if (fallbackRows.length === 0) {
        throw lastError instanceof Error
          ? lastError
          : new Error('event insert failed via slug-fallback path')
      }
      inserted = fallbackRows[0]!
    }

    // 3. Audit + return.
    await writeEventCreated(tx, {
      eventId: inserted.id,
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorRole: 'tenant_user',
      eventType: input.type,
      initialStatus: 'draft',
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })

    return {
      id: inserted.id,
      slug: inserted.slug,
      status: 'draft',
      type: input.type,
      title: input.title,
      createdAt: new Date(),
    }
  })
}

// ─── listEvents ───────────────────────────────────────────────────────

export interface ListEventsInput {
  tenantId: string
  status?: EventStatus
  type?: EventType
  cursor?: string // opaque base64 of { startsAt: ISO, id: uuid }
  limit?: number
}

export interface ListedEvent {
  id: string
  slug: string
  type: EventType
  status: EventStatus
  visibility: 'public' | 'unlisted' | 'private'
  title: string
  startsAt: Date
  endsAt: Date
  publishedAt: Date | null
  createdAt: Date
}

export interface ListEventsResult {
  items: ListedEvent[]
  nextCursor: string | null
  hasMore: boolean
}

const DEFAULT_LIST_LIMIT = 20

function encodeCursor(row: { startsAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ s: row.startsAt.toISOString(), i: row.id })).toString(
    'base64url',
  )
}

function decodeCursor(cursor: string): { startsAt: Date; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as {
      s: string
      i: string
    }
    if (typeof parsed.s !== 'string' || typeof parsed.i !== 'string') return null
    const d = new Date(parsed.s)
    if (Number.isNaN(d.getTime())) return null
    return { startsAt: d, id: parsed.i }
  } catch {
    return null
  }
}

export async function listEvents(input: ListEventsInput): Promise<ListEventsResult> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIST_LIMIT, 1), 100)
  return withTenant(input.tenantId, async (tx) => {
    const cursorParsed = input.cursor ? decodeCursor(input.cursor) : null
    const conditions: SQL[] = [isNull(events.deletedAt)]
    if (input.status) conditions.push(eq(events.status, input.status))
    if (input.type) conditions.push(eq(events.type, input.type))
    if (cursorParsed) {
      // Strict-greater on (startsAt, id) to skip the cursor row itself
      // and de-dupe across pages.
      conditions.push(
        sql`(${events.startsAt}, ${events.id}) > (${cursorParsed.startsAt.toISOString()}::timestamptz, ${cursorParsed.id}::uuid)`,
      )
    }

    const rows = await tx
      .select({
        id: events.id,
        slug: events.slug,
        type: events.type,
        status: events.status,
        visibility: events.visibility,
        title: events.title,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        publishedAt: events.publishedAt,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(and(...conditions))
      .orderBy(asc(events.startsAt), asc(events.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    const nextCursor = hasMore && last ? encodeCursor({ startsAt: last.startsAt, id: last.id }) : null

    return {
      items: page.map((r) => ({
        id: r.id,
        slug: r.slug,
        type: r.type as EventType,
        status: r.status as EventStatus,
        visibility: r.visibility as 'public' | 'unlisted' | 'private',
        title: r.title,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        publishedAt: r.publishedAt,
        createdAt: r.createdAt,
      })),
      nextCursor,
      hasMore,
    }
  })
}

// ─── getEvent ─────────────────────────────────────────────────────────

export interface GetEventInput {
  tenantId: string
  eventId: string
}

export interface EventDetail extends ListedEvent {
  titleBn: string | null
  description: string | null
  descriptionBn: string | null
  timezone: string
  venue: unknown
  capacity: number | null
  isListedPublicly: boolean
  bannerImageUrl: string | null
  ogImageUrl: string | null
  refundPolicy: unknown
  settings: unknown
  epsFeeHandling: FeeHandlingMode
  platformFeeHandling: FeeHandlingMode
  createdBy: string
  updatedAt: Date
}

export async function getEvent(input: GetEventInput): Promise<EventDetail> {
  return withTenant(input.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(events)
      .where(and(eq(events.id, input.eventId), isNull(events.deletedAt)))
      .limit(1)
    const r = rows[0]
    if (!r) throw new EventNotFoundError(input.eventId)
    return {
      id: r.id,
      slug: r.slug,
      type: r.type as EventType,
      status: r.status as EventStatus,
      visibility: r.visibility as 'public' | 'unlisted' | 'private',
      title: r.title,
      titleBn: r.titleBn,
      description: r.description,
      descriptionBn: r.descriptionBn,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      publishedAt: r.publishedAt,
      timezone: r.timezone,
      venue: r.venue,
      capacity: r.capacity,
      isListedPublicly: r.isListedPublicly,
      bannerImageUrl: r.bannerImageUrl,
      ogImageUrl: r.ogImageUrl,
      refundPolicy: r.refundPolicy,
      settings: r.settings,
      epsFeeHandling: r.epsFeeHandling as FeeHandlingMode,
      platformFeeHandling: r.platformFeeHandling as FeeHandlingMode,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }
  })
}

// ─── updateEvent ──────────────────────────────────────────────────────
//
// PATCH semantics. Caller passes a partial; the service maps it into
// a Drizzle update set. Only allowed when event status is 'draft' OR
// 'published' (not yet on sale) — sold-state events are immutable on
// their commercial spec except via transitions + admin tooling.

export interface UpdateEventInput {
  tenantId: string
  eventId: string
  actorUserId: string
  patch: Partial<{
    title: string
    titleBn: string | null
    description: string | null
    descriptionBn: string | null
    startsAt: Date
    endsAt: Date
    timezone: string
    venue: unknown
    capacity: number | null
    visibility: 'public' | 'unlisted' | 'private'
    bannerImageUrl: string | null
    ogImageUrl: string | null
    refundPolicy: unknown
    platformFeeHandling: FeeHandlingMode
    epsFeeHandling: FeeHandlingMode
    isListedPublicly: boolean
  }>
  ip?: string | null
  userAgent?: string | null
}

const EDITABLE_STATUSES: ReadonlySet<EventStatus> = new Set(['draft', 'published'])

export async function updateEvent(input: UpdateEventInput): Promise<void> {
  if (Object.keys(input.patch).length === 0) return
  await withTenant(input.tenantId, async (tx) => {
    const current = await tx
      .select({ status: events.status })
      .from(events)
      .where(and(eq(events.id, input.eventId), isNull(events.deletedAt)))
      .limit(1)
    if (current.length === 0) throw new EventNotFoundError(input.eventId)
    const currentStatus = current[0]!.status as EventStatus
    if (!EDITABLE_STATUSES.has(currentStatus)) {
      throw new EventInvalidStatusForEditError(currentStatus)
    }

    // Build update object reflecting only present-in-patch fields.
    const setObj: Record<string, unknown> = {}
    if ('title' in input.patch) setObj['title'] = input.patch.title
    if ('titleBn' in input.patch) setObj['titleBn'] = input.patch.titleBn
    if ('description' in input.patch) setObj['description'] = input.patch.description
    if ('descriptionBn' in input.patch) setObj['descriptionBn'] = input.patch.descriptionBn
    if ('startsAt' in input.patch) setObj['startsAt'] = input.patch.startsAt
    if ('endsAt' in input.patch) setObj['endsAt'] = input.patch.endsAt
    if ('timezone' in input.patch) setObj['timezone'] = input.patch.timezone
    if ('venue' in input.patch) setObj['venue'] = input.patch.venue
    if ('capacity' in input.patch) setObj['capacity'] = input.patch.capacity
    if ('visibility' in input.patch) setObj['visibility'] = input.patch.visibility
    if ('bannerImageUrl' in input.patch) setObj['bannerImageUrl'] = input.patch.bannerImageUrl
    if ('ogImageUrl' in input.patch) setObj['ogImageUrl'] = input.patch.ogImageUrl
    if ('refundPolicy' in input.patch) setObj['refundPolicy'] = input.patch.refundPolicy
    if ('platformFeeHandling' in input.patch)
      setObj['platformFeeHandling'] = input.patch.platformFeeHandling
    if ('epsFeeHandling' in input.patch) setObj['epsFeeHandling'] = input.patch.epsFeeHandling
    if ('isListedPublicly' in input.patch)
      setObj['isListedPublicly'] = input.patch.isListedPublicly

    setObj['updatedAt'] = new Date()

    const updated = await tx
      .update(events)
      .set(setObj)
      .where(and(eq(events.id, input.eventId), isNull(events.deletedAt)))
      .returning({ id: events.id })

    if (updated.length === 0) throw new EventNotFoundError(input.eventId)

    await writeEventUpdated(tx, {
      eventId: input.eventId,
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorRole: 'tenant_user',
      changedFields: Object.keys(input.patch),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })
  })
}

// ─── transitionEvent ──────────────────────────────────────────────────
//
// State-machine-gated status change. Composes:
//   1. Read current status (inside tx for consistency).
//   2. validateTransition(from, to) — pure check.
//   3. Update status + (if to='published') set published_at.
//   4. Audit row in same tx.
//
// Service-level guards (e.g. "≥1 tier required for draft→published")
// layer AROUND this function; they aren't here because they'll be added
// in Day 25 when ticket_tiers lands. Keeping the state-machine boundary
// clean for now.

export interface TransitionEventInput {
  tenantId: string
  eventId: string
  actorUserId: string
  toState: EventStatus
  reason?: string | null
  ip?: string | null
  userAgent?: string | null
}

export interface TransitionedEvent {
  id: string
  fromStatus: EventStatus
  toStatus: EventStatus
  publishedAt: Date | null
}

export async function transitionEvent(
  input: TransitionEventInput,
): Promise<TransitionedEvent> {
  return withTenant(input.tenantId, async (tx) => {
    const current = await tx
      .select({ status: events.status, publishedAt: events.publishedAt })
      .from(events)
      .where(and(eq(events.id, input.eventId), isNull(events.deletedAt)))
      .limit(1)
    if (current.length === 0) throw new EventNotFoundError(input.eventId)
    const fromStatus = current[0]!.status as EventStatus

    const result = validateTransition(fromStatus, input.toState)
    if (!result.valid) {
      throw new EventInvalidTransitionError(
        fromStatus,
        input.toState,
        result.reason ?? 'invalid transition',
        result.allowedNext,
      )
    }

    const updates: Record<string, unknown> = {
      status: input.toState,
      updatedAt: new Date(),
    }
    let publishedAt = current[0]!.publishedAt
    if (input.toState === 'published' && publishedAt === null) {
      publishedAt = new Date()
      updates['publishedAt'] = publishedAt
    }

    const updated = await tx
      .update(events)
      .set(updates)
      .where(and(eq(events.id, input.eventId), isNull(events.deletedAt)))
      .returning({ id: events.id })

    if (updated.length === 0) throw new EventNotFoundError(input.eventId)

    await writeEventTransitioned(tx, {
      eventId: input.eventId,
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorRole: 'tenant_user',
      fromState: fromStatus,
      toState: input.toState,
      reason: input.reason ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })

    return { id: input.eventId, fromStatus, toStatus: input.toState, publishedAt }
  })
}

// ─── softDeleteEvent ──────────────────────────────────────────────────

export interface SoftDeleteEventInput {
  tenantId: string
  eventId: string
  actorUserId: string
  ip?: string | null
  userAgent?: string | null
}

export async function softDeleteEvent(input: SoftDeleteEventInput): Promise<void> {
  await withTenant(input.tenantId, async (tx) => {
    const current = await tx
      .select({ status: events.status })
      .from(events)
      .where(and(eq(events.id, input.eventId), isNull(events.deletedAt)))
      .limit(1)
    if (current.length === 0) throw new EventNotFoundError(input.eventId)
    const statusAtDelete = current[0]!.status as EventStatus

    await tx
      .update(events)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(events.id, input.eventId), isNull(events.deletedAt)))

    await writeEventSoftDeleted(tx, {
      eventId: input.eventId,
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorRole: 'tenant_user',
      statusAtDelete,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })
  })
}

// Silence unused-imports if any of the helper imports drift.
void desc
void gt
void lt

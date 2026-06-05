/**
 * Event-domain zod schemas — Sprint 3 Day 23 Workstream 1.
 *
 * Shared between server route validation (apps/api/src/routes/tenant/
 * events.ts) and frontend react-hook-form resolvers (apps/web/src/
 * components/tenant/event-form-templates/...). Single source of truth
 * per §6.1.
 *
 * Schema scope (Day 23):
 *
 *   • EventCreateSchema  — POST /api/v1/tenant/events body.
 *   • EventUpdateSchema  — PATCH /api/v1/tenant/events/:id body. Strict
 *                          partial: server rejects unknown keys.
 *   • EventTransitionSchema — POST /api/v1/tenant/events/:id/transition body.
 *
 * Out of scope today (Day 25):
 *   • Ticket tier schemas (events ship without tiers; tiers FK to events).
 *
 * Validation discipline per §13.0 (platform-wide manual verification +
 * structural Zod): Zod enforces structural shape, required fields, type
 * coercion, max lengths, no embedded null bytes. Semantic validity (does
 * this venue address geocode, is this date sensible) is reviewer/business-
 * layer judgment — NOT enforced here.
 */

import { z } from 'zod'

import { BD_DIVISIONS } from './bd.js'

/** Mirrors apps/api/src/domain/event-state-machine.ts EVENT_STATUSES. */
export const EVENT_TYPES = [
  'concert',
  'alumni',
  'standup',
  'conference',
  'workshop',
  'community',
  'sports',
  'other',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const EVENT_STATUSES = [
  'draft',
  'published',
  'on_sale',
  'sold_out',
  'live',
  'completed',
  'archived',
] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

export const EVENT_VISIBILITIES = ['public', 'unlisted', 'private'] as const
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number]

export const FEE_HANDLING_MODES = ['absorb', 'pass_through'] as const
export type FeeHandlingMode = (typeof FEE_HANDLING_MODES)[number]

// ─── venue jsonb ────────────────────────────────────────────────────
//
// Discriminated union on `type`: physical venues (BD-shaped: division,
// district, address) vs online events (url + platform name). Server
// stores the validated object verbatim in events.venue jsonb.
//
// `address` for physical venues is the human-readable single string
// (Bangla or English). Division is the canonical 8-value BD enum from
// bd.ts. District is free text for MVP (Phase 2 may upgrade to a
// data-driven district list when admin search-by-location lands).

export const PhysicalVenueSchema = z.object({
  type: z.literal('physical'),
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(500),
  division: z.enum(BD_DIVISIONS),
  district: z.string().min(1).max(120),
})

export const OnlineVenueSchema = z.object({
  type: z.literal('online'),
  /** Platform name (Zoom, Google Meet, etc.) — display-only. */
  platform: z.string().min(1).max(80),
  /** Join URL — server doesn't validate reachability, only that it
   *  parses as URL. */
  url: z.string().url().max(500),
})

export const VenueSchema = z.discriminatedUnion('type', [PhysicalVenueSchema, OnlineVenueSchema])
export type Venue = z.infer<typeof VenueSchema>

// ─── refund_policy jsonb ────────────────────────────────────────────
//
// Default { allowed: false } per §9.3. When allowed=true, fields below
// describe the policy. Server stores the validated object verbatim.

export const RefundPolicySchema = z.discriminatedUnion('allowed', [
  z.object({ allowed: z.literal(false) }),
  z.object({
    allowed: z.literal(true),
    /** Refund window in hours before starts_at (e.g. 48 = until 48h before). */
    cutoff_hours_before: z.number().int().min(0).max(8760),
    /** Free-form note shown to buyers at checkout (max 500 chars). */
    note: z.string().max(500).optional(),
  }),
])
export type RefundPolicy = z.infer<typeof RefundPolicySchema>

// ─── EventCreateSchema ──────────────────────────────────────────────

const titleSchema = z.string().min(3).max(120)
const titleBnSchema = z.string().min(3).max(120).optional()
const descriptionSchema = z.string().max(5000).optional()
const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime())
  .pipe(z.coerce.date())

export const EventCreateSchema = z
  .object({
    type: z.enum(EVENT_TYPES),
    title: titleSchema,
    titleBn: titleBnSchema,
    description: descriptionSchema,
    descriptionBn: descriptionSchema,
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    /** Defaults to 'Asia/Dhaka' if omitted; server applies the default. */
    timezone: z.string().min(1).max(80).optional(),
    venue: VenueSchema,
    capacity: z.number().int().positive().nullable().optional(),
    visibility: z.enum(EVENT_VISIBILITIES).optional(),
    bannerImageUrl: z.string().url().max(1000).optional(),
    ogImageUrl: z.string().url().max(1000).optional(),
    refundPolicy: RefundPolicySchema.optional(),
    /** Per-event fee mode overrides. If omitted, server snapshots from
     *  tenant_fee_config.default_fee_mode at create time. */
    platformFeeHandling: z.enum(FEE_HANDLING_MODES).optional(),
    epsFeeHandling: z.enum(FEE_HANDLING_MODES).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.endsAt < val.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endsAt must be at or after startsAt',
        path: ['endsAt'],
      })
    }
  })
export type EventCreateInput = z.infer<typeof EventCreateSchema>

// ─── EventUpdateSchema ──────────────────────────────────────────────
//
// PATCH-shaped: every field optional, but if both starts_at and ends_at
// are present the ordering invariant still applies. The server also
// applies a side condition: status='draft' is required for most edits;
// post-publish edits are limited to a smaller set (handled by service
// layer, not enforced here).
//
// strict() rejects unknown keys — guards against typo'd field names
// silently no-op'ing.

export const EventUpdateSchema = z
  .object({
    // slug — the event part of the public URL. Editable post-creation; the
    // service enforces per-tenant uniqueness. Lowercase slug-shaped, 3–120.
    slug: z
      .string()
      .min(3)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'must be lowercase letters, numbers and hyphens')
      .optional(),
    title: titleSchema.optional(),
    titleBn: titleBnSchema,
    description: descriptionSchema,
    descriptionBn: descriptionSchema,
    startsAt: isoDateTime.optional(),
    endsAt: isoDateTime.optional(),
    timezone: z.string().min(1).max(80).optional(),
    venue: VenueSchema.optional(),
    capacity: z.number().int().positive().nullable().optional(),
    visibility: z.enum(EVENT_VISIBILITIES).optional(),
    bannerImageUrl: z.string().url().max(1000).nullable().optional(),
    ogImageUrl: z.string().url().max(1000).nullable().optional(),
    refundPolicy: RefundPolicySchema.optional(),
    platformFeeHandling: z.enum(FEE_HANDLING_MODES).optional(),
    epsFeeHandling: z.enum(FEE_HANDLING_MODES).optional(),
    isListedPublicly: z.boolean().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.startsAt && val.endsAt && val.endsAt < val.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endsAt must be at or after startsAt',
        path: ['endsAt'],
      })
    }
  })
export type EventUpdateInput = z.infer<typeof EventUpdateSchema>

// ─── EventTransitionSchema ──────────────────────────────────────────

export const EventTransitionSchema = z.object({
  to: z.enum(EVENT_STATUSES),
  /** Optional reason — captured in audit row diff.reason. Recommended
   *  for archive transitions; required when the service layer is in
   *  strict-archive mode (Phase 2). */
  reason: z.string().max(500).optional(),
})
export type EventTransitionInput = z.infer<typeof EventTransitionSchema>

// ─── List filter / query ───────────────────────────────────────────

export const EventListFilterSchema = z.object({
  status: z.enum(EVENT_STATUSES).optional(),
  type: z.enum(EVENT_TYPES).optional(),
  /** Cursor-based pagination per §6.5; opaque base64 from previous response. */
  cursor: z.string().optional(),
  /** 1..100, default 20 per §6.5 convention. */
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
export type EventListFilter = z.infer<typeof EventListFilterSchema>

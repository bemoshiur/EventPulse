/**
 * Ticket-tier-domain zod schemas — Sprint 3 Day 25.
 *
 * Shared between server route validation (apps/api/src/routes/tenant/
 * ticket-tiers.ts) and frontend react-hook-form resolvers (apps/web/src/
 * components/tenant/ticket-tier-form/...). Single source of truth per
 * §6.1.
 *
 * Schema scope:
 *
 *   • TicketTierCreateSchema  — POST /api/v1/tenant/events/:eventId/tickets body.
 *   • TicketTierUpdateSchema  — PATCH /api/v1/tenant/events/:eventId/tickets/:tierId body.
 *
 * `archive` is a separate POST endpoint (no body); no schema needed
 * beyond the URL params.
 *
 * Money: pricePaisa is `bigint` per §1.3 R2. The wire format from
 * browser-side react-hook-form will be a string (HTML input numeric
 * values can exceed Number.MAX_SAFE_INTEGER paisa for very large
 * events — though unlikely in practice). z.coerce.bigint accepts
 * numbers + numeric strings.
 *
 * Validation discipline per §13.0 (structural Zod, semantic judgment
 * is reviewer/business-layer): Zod enforces shape, types, value-set
 * membership, ordering invariants. Semantic checks (does this tier
 * make sense for this event type, is the price reasonable) are tenant
 * judgment + admin oversight, NOT enforced here.
 */

import { z } from 'zod'

// ─── shared sub-schemas ────────────────────────────────────────────────

const nameSchema = z.string().min(1).max(120)
const descriptionSchema = z.string().max(1000).optional().nullable()

/**
 * Price in paisa. Accepts numeric (frontend HTML input) or string
 * (large values that round-trip safely). Coerces to bigint per §1.3 R2.
 * Min 0 (free tiers allowed); max ~10^15 paisa (more than total BD
 * GDP — sanity bound, not regulatory).
 */
const pricePaisaSchema = z.coerce.bigint().nonnegative().max(BigInt('1000000000000000'))

const capacitySchema = z.coerce.number().int().positive()
const sortOrderSchema = z.coerce.number().int().min(0).max(10_000)

const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime())
  .pipe(z.coerce.date())

// ─── TicketTierCreateSchema ────────────────────────────────────────────

export const TicketTierCreateSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema,
    pricePaisa: pricePaisaSchema,
    capacity: capacitySchema,
    salesStartAt: isoDateTime.optional().nullable(),
    salesEndAt: isoDateTime.optional().nullable(),
    minPerOrder: z.coerce.number().int().min(1).max(100).optional(),
    maxPerOrder: z.coerce.number().int().min(1).max(100).optional(),
    isComplimentary: z.boolean().optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.maxPerOrder != null && val.minPerOrder != null && val.maxPerOrder < val.minPerOrder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'maxPerOrder must be >= minPerOrder',
        path: ['maxPerOrder'],
      })
    }
    if (val.salesStartAt != null && val.salesEndAt != null && val.salesEndAt <= val.salesStartAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'salesEndAt must be after salesStartAt',
        path: ['salesEndAt'],
      })
    }
    if (val.isComplimentary === true && val.pricePaisa !== 0n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'complimentary tiers must have pricePaisa = 0',
        path: ['pricePaisa'],
      })
    }
  })
export type TicketTierCreateInput = z.infer<typeof TicketTierCreateSchema>

// ─── TicketTierUpdateSchema ───────────────────────────────────────────
//
// PATCH-shaped: every field optional. The `sold` counter is NOT
// surfaced — it's managed by the order pipeline at paid-state
// transition, never by the tenant directly. `archivedAt` also not
// here — use the separate POST /:tierId/archive endpoint.
//
// strict() rejects unknown keys.

export const TicketTierUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema,
    pricePaisa: pricePaisaSchema.optional(),
    capacity: capacitySchema.optional(),
    salesStartAt: isoDateTime.optional().nullable(),
    salesEndAt: isoDateTime.optional().nullable(),
    minPerOrder: z.coerce.number().int().min(1).max(100).optional(),
    maxPerOrder: z.coerce.number().int().min(1).max(100).optional(),
    isComplimentary: z.boolean().optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.maxPerOrder != null && val.minPerOrder != null && val.maxPerOrder < val.minPerOrder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'maxPerOrder must be >= minPerOrder',
        path: ['maxPerOrder'],
      })
    }
    if (val.salesStartAt != null && val.salesEndAt != null && val.salesEndAt <= val.salesStartAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'salesEndAt must be after salesStartAt',
        path: ['salesEndAt'],
      })
    }
    if (val.isComplimentary === true && val.pricePaisa != null && val.pricePaisa !== 0n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'complimentary tiers must have pricePaisa = 0',
        path: ['pricePaisa'],
      })
    }
  })
export type TicketTierUpdateInput = z.infer<typeof TicketTierUpdateSchema>

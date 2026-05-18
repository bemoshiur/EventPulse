/**
 * KYC draft routes — Sprint 2 Day 16 Item 12 (wizard backend).
 *
 * Server-side resumable drafts for the KYC wizard. The wizard creates a
 * `kyc_submissions` row in `status='draft'` on step 1 entry, PATCHes
 * the row's fields/documents jsonb columns as the user fills each
 * step, and transitions the row to `submitted` on final submit.
 *
 * Decision: .claude/memory/decisions.md 2026-05-18 "KYC wizard uses
 *           server-side drafts (activates the `draft` status added in
 *           migration 0005) — not localStorage".
 *
 * Endpoints (mounted at /api/v1/tenant/kyc/drafts):
 *
 *   POST   /                — create a draft row (idempotent on PK)
 *   GET    /:id             — read a draft row (RLS-scoped)
 *   PATCH  /:id             — partial update (per-step sub-schema)
 *   POST   /:id/submit      — finalise (transition draft → submitted)
 *
 * Auth: requireTenantAuth + requireTenantType. A user cannot start the
 * wizard until their account type is set (Item 11 gate).
 *
 * Day 16 ships Individual Tier 1 only. Day 17 adds Organisation Tier A
 * by extending the discriminated union in schemas/kyc.ts; this router
 * branches on c.get('tenantType') to pick the variant schemas.
 *
 * Cross-tenant safety (defence-in-depth):
 *   1. RLS USING (tenant_id = current_setting('app.current_tenant_id'))
 *      filters all queries.
 *   2. Explicit `.where(eq(kycSubmissions.tenantId, tenantId))` on every
 *      query (per Day 15 /review finding #1 pattern).
 *   3. submissionId in body/path is NEVER trusted for tenant scoping —
 *      tenant_id always comes from the JWT-populated context.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { requireTenantAuth } from '../../auth/middleware.js'
import { requireTenantType } from '../../auth/tenant-type-gate.js'
import { withTenant } from '../../db/client.js'
import { kycSubmissions } from '../../db/schema/index.js'
import { transition } from '../../domain/kyc/state-machine.js'
import {
  ALLOWED_CONTENT_TYPES,
  buildKycObjectUri,
  type KycDocumentType,
} from '../../infra/s3/client.js'
import { logger } from '../../lib/logger.js'
// KYC schemas live in @eventpulse/shared-types per §3.2 so the
// frontend wizard (PR 3) can import the same source-of-truth schemas
// the backend validates against. Moved here from apps/api in PR 3.
// Day 17 adds Organisation Tier A — both schemas are imported and the
// PATCH + submit handlers branch on `tenantType` to pick the right one.
import {
  IndividualTier1PatchSchema,
  IndividualTier1SubmissionSchema,
  OrganisationTierAPatchSchema,
  OrganisationTierASubmissionSchema,
  type IndividualTier1Patch,
  type OrganisationTierAPatch,
} from '@eventpulse/shared-types'
import {
  computeFieldDiff,
  writeKycDraftCreated,
  writeKycDraftUpdated,
  writeKycTransition,
} from '../../services/audit/kyc.js'
import { sendKycSubmittedNotice } from '../../services/notifications/kyc.js'

const drafts = new Hono()

drafts.use('*', requireTenantAuth)
drafts.use('*', requireTenantType)

// ─── helpers ──────────────────────────────────────────────────────────

function envelope<T>(data: T) {
  return { data }
}

function errorEnvelope(code: string, message: string, requestId: string | null, details?: unknown) {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      request_id: requestId,
    },
  }
}

/**
 * Sanitise a `z.ZodIssue[]` before echoing to the client in a 400
 * response. Strips to `{ code, path, message }` only — the `received`,
 * `unionErrors`, and other Zod-internal fields can carry the rejected
 * input value, which is a §1.3 R5 PII risk on the KYC surface (NID
 * number, eTIN, bank account number would all land in the response
 * body and in any request-logging middleware that captures 400 bodies).
 *
 * Custom `.refine()` messages in `apps/api/src/schemas/kyc.ts` are
 * also vetted to never interpolate input values into the message
 * string; if a future refine ever does, this sanitiser caps the blast
 * radius to whatever ends up in `message` (which is already the
 * minimal field that a client genuinely needs to render an error).
 *
 * Per Day 16 /review #2 (medium, confidence 88).
 */
function sanitiseZodIssues(issues: z.ZodIssue[]): Array<{
  code: string
  path: (string | number)[]
  message: string
}> {
  return issues.map((issue) => ({
    code: issue.code,
    path: issue.path,
    message: issue.message,
  }))
}

class DraftNotFoundError extends Error {
  constructor(public readonly submissionId: string) {
    super(`Draft submission ${submissionId} not found in tenant context`)
    this.name = 'DraftNotFoundError'
  }
}

class DraftNotInDraftStateError extends Error {
  constructor(
    public readonly submissionId: string,
    public readonly currentStatus: string,
  ) {
    super(`Draft submission ${submissionId} is in status='${currentStatus}', not 'draft'`)
    this.name = 'DraftNotInDraftStateError'
  }
}

class SubmissionIdInUseError extends Error {
  constructor(public readonly submissionId: string) {
    super(`KYC submission id ${submissionId} already in use`)
    this.name = 'SubmissionIdInUseError'
  }
}

class SubmissionIncompleteError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    super(`Submission is incomplete; ${issues.length} validation error(s)`)
    this.name = 'SubmissionIncompleteError'
  }
}

/**
 * Map the tenant type to the default tier requested at draft creation.
 * MVP starts every submission at the base tier; higher tiers
 * (`tier_2`, `tier_3`, `org_b`, `org_c`) are reached through reviewer-
 * driven promotion, not tenant-side selection at draft time.
 */
function defaultTierForType(tenantType: 'individual' | 'organisation'): 'tier_1' | 'org_a' {
  return tenantType === 'individual' ? 'tier_1' : 'org_a'
}

/**
 * Map a wizard step name to its target jsonb key under `kyc_submissions.
 * fields`. For Individual Tier 1 the step name IS the key (`identity`,
 * `address`, `financial`). For Org Tier A the step names are verbose
 * but jsonb keys are shorter per the 2026-05-19 decision (`fields.org`,
 * `fields.signatory`).
 *
 * Document-only steps (`signatory_docs`, `org_docs`) never PATCH fields
 * — their schema has `fields: z.never().optional()` — so they don't
 * route through this function in practice. They're included for
 * exhaustiveness checking, mapping to the same key as their text-only
 * sibling step so a future schema change can't accidentally split.
 */
function fieldsKeyForStep(
  step:
    | 'identity'
    | 'address'
    | 'financial'
    | 'org_info'
    | 'signatory_identity'
    | 'signatory_docs'
    | 'org_docs',
): string {
  switch (step) {
    case 'identity':
    case 'address':
    case 'financial':
      return step
    case 'org_info':
    case 'org_docs':
      return 'org'
    case 'signatory_identity':
    case 'signatory_docs':
      return 'signatory'
  }
}

// ─── POST / — create a draft row ──────────────────────────────────────

const createDraftSchema = z.object({
  /**
   * Client-generated UUID v4. Same idempotency model as Item 9:
   * an INSERT … ON CONFLICT DO NOTHING + SELECT-back means a retry
   * with the same id returns the existing row rather than 500-ing.
   */
  submissionId: z.string().uuid(),
})

drafts.post('/', zValidator('json', createDraftSchema), async (c) => {
  const input = c.req.valid('json')
  const tenantId = c.get('tenantId')!
  const tenantType = c.get('tenantType')!
  const auth = c.get('auth')!
  const requestId = c.req.header('x-request-id') ?? null
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = c.req.header('user-agent') ?? null

  const submissionType = tenantType
  const tierRequested = defaultTierForType(tenantType)

  try {
    const { row, created } = await withTenant(tenantId, async (tx) => {
      const inserted = await tx
        .insert(kycSubmissions)
        .values({
          id: input.submissionId,
          tenantId,
          submissionType,
          tierRequested,
          documents: {},
          fields: {},
          status: 'draft',
        })
        .onConflictDoNothing({ target: kycSubmissions.id })
        .returning()

      if (inserted.length > 0) {
        await writeKycDraftCreated(tx, {
          submissionId: input.submissionId,
          tenantId,
          submissionType,
          tierRequested,
          actorUserId: auth.sub,
          actorRole: 'tenant_user',
          ip,
          userAgent,
        })
        return { row: inserted[0]!, created: true }
      }

      // PK collision — load existing under same tenant. Cross-tenant
      // collision (another tenant owns the PK) yields zero rows → 409.
      const existing = await tx
        .select()
        .from(kycSubmissions)
        .where(
          and(eq(kycSubmissions.id, input.submissionId), eq(kycSubmissions.tenantId, tenantId)),
        )
        .limit(1)

      if (existing.length === 0) {
        throw new SubmissionIdInUseError(input.submissionId)
      }
      return { row: existing[0]!, created: false }
    })

    return c.json(envelope(row), created ? 201 : 200)
  } catch (err) {
    if (err instanceof SubmissionIdInUseError) {
      return c.json(
        errorEnvelope(
          'CONFLICT',
          'submissionId already in use; generate a new UUID and retry',
          requestId,
        ),
        409,
      )
    }
    logger.error({ err, tenantId, submissionId: input.submissionId }, 'kyc draft create failed')
    return c.json(errorEnvelope('INTERNAL_ERROR', 'failed to create draft', requestId), 500)
  }
})

// ─── GET /:id — read a draft row ──────────────────────────────────────

const idParamSchema = z.object({ id: z.string().uuid() })

drafts.get('/:id', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param')
  const tenantId = c.get('tenantId')!
  const requestId = c.req.header('x-request-id') ?? null

  try {
    const row = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(kycSubmissions)
        .where(and(eq(kycSubmissions.id, id), eq(kycSubmissions.tenantId, tenantId)))
        .limit(1)
      if (rows.length === 0) throw new DraftNotFoundError(id)
      return rows[0]!
    })
    return c.json(envelope(row))
  } catch (err) {
    if (err instanceof DraftNotFoundError) {
      return c.json(errorEnvelope('NOT_FOUND', 'draft not found', requestId), 404)
    }
    logger.error({ err, tenantId, submissionId: id }, 'kyc draft read failed')
    return c.json(errorEnvelope('INTERNAL_ERROR', 'failed to read draft', requestId), 500)
  }
})

// ─── PATCH /:id — partial update of one step ──────────────────────────
//
// Validates against the per-step sub-schema for tenant.type='individual';
// Day 17 adds the organisation branch. The merge is field-by-field:
//   fields_new = fields_old || { <step>: <validated step data> }
//   documents_new = documents_old || <materialised document URIs>
// Server replaces the WHOLE step's sub-object in fields (the wizard
// PATCHes a step at a time; revisiting a step replaces it entirely) but
// preserves OTHER steps. Documents are shallow-merged by document type.

drafts.patch(
  '/:id',
  zValidator('param', idParamSchema),
  // Body validation depends on tenantType. We use a permissive parse
  // first, then branch into the type-specific discriminated union below
  // inside the handler — Hono's zValidator runs once at parse time and
  // doesn't have access to c.get('tenantType').
  zValidator('json', z.unknown()),
  async (c) => {
    const { id } = c.req.valid('param')
    const tenantId = c.get('tenantId')!
    const tenantType = c.get('tenantType')!
    const auth = c.get('auth')!
    const requestId = c.req.header('x-request-id') ?? null
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const userAgent = c.req.header('user-agent') ?? null

    // Pick the per-tier PATCH schema by tenant type. Day 17 wires the
    // Org Tier A branch alongside Individual Tier 1 (Day 16). Both
    // schemas converge on the same `{step, fields?, documents?}` shape;
    // only the per-step field validators differ.
    const rawBody = c.req.valid('json')
    const patchSchema =
      tenantType === 'individual' ? IndividualTier1PatchSchema : OrganisationTierAPatchSchema
    const parsed = patchSchema.safeParse(rawBody)
    if (!parsed.success) {
      return c.json(
        errorEnvelope(
          'VALIDATION_ERROR',
          'invalid PATCH body',
          requestId,
          sanitiseZodIssues(parsed.error.issues),
        ),
        400,
      )
    }
    const patch: IndividualTier1Patch | OrganisationTierAPatch = parsed.data

    try {
      const row = await withTenant(tenantId, async (tx) => {
        const rows = await tx
          .select()
          .from(kycSubmissions)
          .where(and(eq(kycSubmissions.id, id), eq(kycSubmissions.tenantId, tenantId)))
          .for('update')
          .limit(1)
        if (rows.length === 0) throw new DraftNotFoundError(id)
        const existing = rows[0]!
        if (existing.status !== 'draft') {
          throw new DraftNotInDraftStateError(id, existing.status)
        }

        const existingFields = (existing.fields ?? {}) as Record<string, unknown>
        const existingDocs = (existing.documents ?? {}) as Record<string, string>

        // Build the new fields object IF the PATCH carries fields. A
        // document-only PATCH (fields omitted OR empty object) MUST NOT
        // trigger a fields merge — `||` shallow merge would replace
        // `fields.<step>` with `{}` and wipe the user's typed values.
        // Per Day 16 PR 3 /review BLOCKER 1.
        //
        // The jsonb key under `fields` is NOT the step name verbatim
        // for Org Tier A (see fieldsKeyForStep + decisions.md 2026-05-19).
        const stepKey = fieldsKeyForStep(patch.step)
        const patchFields = patch.fields as Record<string, unknown> | undefined
        const hasFields = patchFields !== undefined && Object.keys(patchFields).length > 0

        // Build the materialised documents map for any document slots
        // this PATCH declares. Server derives the S3 URI from
        // (tenantId, submissionId, documentType, contentType) — client
        // cannot smuggle in an arbitrary path. The check is now
        // schema-agnostic — `patch.documents` is `z.never().optional()`
        // on text-only step branches so the loop is a no-op there.
        const mergeDocs: Record<string, string> = {}
        if (patch.documents) {
          for (const [docTypeKey, decl] of Object.entries(patch.documents)) {
            if (!decl) continue
            const docType = docTypeKey as KycDocumentType
            mergeDocs[docTypeKey] = buildKycObjectUri({
              tenantId,
              submissionId: id,
              documentType: docType,
              contentType: (decl as { contentType: string })
                .contentType as keyof typeof ALLOWED_CONTENT_TYPES,
            })
          }
        }
        const hasDocs = Object.keys(mergeDocs).length > 0

        // Reject no-op PATCH bodies early — a request that carries
        // neither fields nor documents tells the server nothing.
        if (!hasFields && !hasDocs) {
          return existing
        }

        // Compute the path-level diff BEFORE writing — both the before
        // and after snapshots are taken from data the handler already
        // holds, so no extra SELECT is needed.
        const fieldsDiff = hasFields
          ? computeFieldDiff(
              (existingFields[stepKey] ?? undefined) as never,
              patchFields as never,
              `fields.${stepKey}`,
            )
          : { added: [], updated: [], removed: [] }
        const docsBefore = existingDocs as Record<string, unknown>
        const docsAfter = { ...docsBefore, ...mergeDocs } as Record<string, unknown>
        const docsDiff = computeFieldDiff(docsBefore as never, docsAfter as never, 'documents')

        // Combine field paths + doc paths into a single audit diff row.
        const combinedDiff = {
          fields: {
            added: [...fieldsDiff.added, ...docsDiff.added],
            updated: [...fieldsDiff.updated, ...docsDiff.updated],
            removed: [...fieldsDiff.removed, ...docsDiff.removed],
          },
        }

        // No-op PATCH guard: if nothing actually changes (idempotent
        // re-PATCH of the same step data), don't write an audit row.
        const hasAnyChange =
          combinedDiff.fields.added.length > 0 ||
          combinedDiff.fields.updated.length > 0 ||
          combinedDiff.fields.removed.length > 0

        // Issue the UPDATE. `||` is jsonb concatenation (shallow merge);
        // both columns are merged only when there's something to merge.
        // A fields-absent PATCH skips the fields update entirely so
        // prior typed values aren't wiped (BLOCKER 1 invariant).
        const setClause: Record<string, unknown> = { updatedAt: new Date() }
        if (hasFields) {
          const mergeFields = { [stepKey]: patchFields }
          const fieldsJson = JSON.stringify(mergeFields)
          setClause['fields'] = sql`${kycSubmissions.fields} || ${fieldsJson}::jsonb`
        }
        if (hasDocs) {
          const docsJson = JSON.stringify(mergeDocs)
          setClause['documents'] = sql`${kycSubmissions.documents} || ${docsJson}::jsonb`
        }
        const updated = await tx
          .update(kycSubmissions)
          .set(setClause)
          .where(
            and(
              eq(kycSubmissions.id, id),
              eq(kycSubmissions.tenantId, tenantId),
              eq(kycSubmissions.status, 'draft'),
            ),
          )
          .returning()

        if (updated.length === 0) {
          // Race: row's status changed between SELECT FOR UPDATE and the
          // UPDATE. Should be impossible since FOR UPDATE holds the row
          // lock for the duration of the tx, but fail-closed regardless.
          throw new DraftNotInDraftStateError(id, 'unknown')
        }

        if (hasAnyChange) {
          await writeKycDraftUpdated(tx, {
            submissionId: id,
            tenantId,
            step: patch.step,
            diff: combinedDiff,
            actorUserId: auth.sub,
            actorRole: 'tenant_user',
            ip,
            userAgent,
          })
        }
        return updated[0]!
      })
      return c.json(envelope(row))
    } catch (err) {
      if (err instanceof DraftNotFoundError) {
        return c.json(errorEnvelope('NOT_FOUND', 'draft not found', requestId), 404)
      }
      if (err instanceof DraftNotInDraftStateError) {
        return c.json(
          errorEnvelope(
            'CONFLICT',
            `cannot PATCH a submission in status='${err.currentStatus}'`,
            requestId,
          ),
          409,
        )
      }
      logger.error({ err, tenantId, submissionId: id }, 'kyc draft patch failed')
      return c.json(errorEnvelope('INTERNAL_ERROR', 'failed to patch draft', requestId), 500)
    }
  },
)

// ─── POST /:id/submit — finalise the draft ────────────────────────────
//
// Validates the accumulated row's fields + documents against the full-
// tier schema. On success: transition('draft', 'submitted'), audit row,
// fire-and-forget notification. On validation failure: 400 with the
// per-issue path so the wizard can navigate the user back to the
// offending step.

drafts.post('/:id/submit', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param')
  const tenantId = c.get('tenantId')!
  const tenantType = c.get('tenantType')!
  const auth = c.get('auth')!
  const requestId = c.req.header('x-request-id') ?? null
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = c.req.header('user-agent') ?? null

  try {
    const { row, transitionedNow } = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(kycSubmissions)
        .where(and(eq(kycSubmissions.id, id), eq(kycSubmissions.tenantId, tenantId)))
        .for('update')
        .limit(1)
      if (rows.length === 0) throw new DraftNotFoundError(id)
      const existing = rows[0]!

      // Idempotency: if already submitted, return the row without
      // writing a duplicate audit or firing a duplicate notification.
      if (existing.status === 'submitted') {
        return { row: existing, transitionedNow: false }
      }
      if (existing.status !== 'draft') {
        throw new DraftNotInDraftStateError(id, existing.status)
      }

      // Validate the full accumulated state against the per-tier
      // submission schema. Day 17 adds the Org Tier A branch alongside
      // Individual Tier 1.
      const accumulated = {
        fields: existing.fields,
        documents: existing.documents,
      }
      const submissionSchema =
        tenantType === 'individual'
          ? IndividualTier1SubmissionSchema
          : OrganisationTierASubmissionSchema
      const parsed = submissionSchema.safeParse(accumulated)
      if (!parsed.success) {
        throw new SubmissionIncompleteError(parsed.error.issues)
      }

      // State machine: assert draft → submitted is legal.
      transition('draft', 'submitted')

      const updated = await tx
        .update(kycSubmissions)
        .set({ status: 'submitted', updatedAt: new Date() })
        .where(
          and(
            eq(kycSubmissions.id, id),
            eq(kycSubmissions.tenantId, tenantId),
            eq(kycSubmissions.status, 'draft'),
          ),
        )
        .returning()
      if (updated.length === 0) {
        throw new DraftNotInDraftStateError(id, 'unknown')
      }

      await writeKycTransition(tx, {
        submissionId: id,
        tenantId,
        fromState: 'draft',
        toState: 'submitted',
        actorUserId: auth.sub,
        actorRole: 'tenant_user',
        ip,
        userAgent,
      })
      return { row: updated[0]!, transitionedNow: true }
    })

    if (transitionedNow) {
      // Fire-and-forget notification AFTER tx commits, same pattern as
      // Item 9 to prevent 500-after-commit if notification dispatch
      // fails (per Day 14 /review finding #3).
      sendKycSubmittedNotice({
        tenantId,
        submissionId: id,
      }).catch((notifyErr) =>
        logger.error(
          { err: notifyErr, tenantId, submissionId: id },
          'kyc submitted notification failed (state change already committed)',
        ),
      )
    }

    // Both first-submit and idempotent re-submit return 200; REST
    // convention for "row already exists" semantics. The
    // `transitionedNow` flag's only effect is whether the notification
    // fires (above) and an extra audit row is written (inside the tx).
    return c.json(envelope(row))
  } catch (err) {
    if (err instanceof DraftNotFoundError) {
      return c.json(errorEnvelope('NOT_FOUND', 'draft not found', requestId), 404)
    }
    if (err instanceof DraftNotInDraftStateError) {
      return c.json(
        errorEnvelope(
          'CONFLICT',
          `cannot submit a draft in status='${err.currentStatus}'`,
          requestId,
        ),
        409,
      )
    }
    if (err instanceof SubmissionIncompleteError) {
      return c.json(
        errorEnvelope(
          'VALIDATION_ERROR',
          'submission is incomplete or invalid; complete all required steps and re-submit',
          requestId,
          sanitiseZodIssues(err.issues),
        ),
        400,
      )
    }
    logger.error({ err, tenantId, submissionId: id }, 'kyc draft submit failed')
    return c.json(errorEnvelope('INTERNAL_ERROR', 'failed to submit draft', requestId), 500)
  }
})

export { drafts as kycDraftRoutes }

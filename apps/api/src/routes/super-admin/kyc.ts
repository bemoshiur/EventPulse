/**
 * Super admin KYC review queue routes — Sprint 2 Day 18 Item 13.
 *
 * The highest-PII-sensitivity API in the project. Reviewer surfaces NID
 * images, NID numbers, DOB, addresses, bank accounts, eTINs, selfies,
 * BINs, RJSC certificates for every tenant going through KYC.
 *
 * Per `.claude/memory/decisions.md` 2026-05-19 "Item 13 super admin KYC
 * review queue — pre-code architecture (Decisions G, H, I)":
 *
 *   Decision G — Every detail-view GET writes an audit_log row. List
 *                view does NOT audit per row.
 *   Decision H — (Frontend) per-query cache override staleTime: 0 /
 *                gcTime: 0 on detail view. This module doesn't enforce
 *                that — the frontend hook does. The server-side
 *                contract is that every detail GET returns fresh data
 *                + writes an audit row.
 *   Decision I — Structured reviewer checklist + free-text notes.
 *                Per-tier required keys server-enforced on approve
 *                (409 CHECKLIST_INCOMPLETE).
 *
 * Per `.claude/memory/decisions.md` "Platform-wide policy — manual
 * verification only for MVP" (2026-05-19): NO validation badges, NO
 * `flags` column, NO auto-flag UI. Raw data + reviewer notes +
 * checklist tracking are the entire concern-surfacing surface.
 *
 * Endpoints (mounted at /api/v1/admin/kyc):
 *
 *   GET    /submissions               — list view (no per-row audit)
 *   GET    /submissions/:id           — detail view (writes audit row)
 *   PATCH  /submissions/:id/checklist — toggle one key (writes audit)
 *   PATCH  /submissions/:id/notes     — update notes (writes audit)
 *   POST   /submissions/:id/decide    — approve | reject (writes audit
 *                                       + transitions state + fires
 *                                       notification stub)
 *
 * Auth: requireSuperAdminAuth. All five endpoints run under
 * withSuperAdmin() since:
 *   (a) reviewer reads must span tenants for the queue,
 *   (b) audit_logs INSERTs need to populate tenant_id from the
 *       submission row (the super-admin's session has no tenant
 *       context), so BYPASSRLS lets us write tenant-tagged rows
 *       from a non-tenant session.
 *
 * Conflict-of-interest check on approve: returns 409
 * CONFLICT_OF_INTEREST if the reviewer's actor_id has previously
 * written an actor_type='tenant_user' audit row for this submission.
 * Backed by the composite index on audit_logs(entity_type, entity_id,
 * actor_id) added in migration 0007.
 *
 * Subdomain provisioning on approve: TODO-stubbed per Day 18 brief
 * §2.5; the route fires the approval notification stub but does NOT
 * call SSM for Nginx vhost generation (Item 16 / Day 20).
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { requireSuperAdminAuth } from '../../auth/middleware.js'
import { withSuperAdmin } from '../../db/client.js'
import { auditLogs, kycSubmissions, tenants } from '../../db/schema/index.js'
import { transition } from '../../domain/kyc/state-machine.js'
import { getKycSignedGetUrls } from '../../infra/s3/signed-get.js'
import { logger } from '../../lib/logger.js'
import {
  KycSubmissionListFilterSchema,
  ReviewerChecklistTogglePatchSchema,
  ReviewerDecisionSchema,
  ReviewerNotesPatchSchema,
  requiredChecklistKeysFor,
  type ReviewerChecklist,
} from '@eventpulse/shared-types'
import {
  writeKycChecklistToggled,
  writeKycDecided,
  writeKycNotesUpdated,
  writeKycSubmissionViewed,
  writeKycTransition,
} from '../../services/audit/kyc.js'
import { sendKycApprovedNotice, sendKycRejectedNotice } from '../../services/notifications/kyc.js'

const admin = new Hono()

admin.use('*', requireSuperAdminAuth)

// ─── helpers ──────────────────────────────────────────────────────────

function envelope<T>(data: T, meta?: Record<string, unknown>) {
  return meta !== undefined ? { data, meta } : { data }
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

class SubmissionNotFoundError extends Error {
  constructor(public readonly submissionId: string) {
    super(`KYC submission ${submissionId} not found`)
    this.name = 'SubmissionNotFoundError'
  }
}

class SubmissionNotDecidableError extends Error {
  constructor(
    public readonly submissionId: string,
    public readonly currentStatus: string,
  ) {
    super(`KYC submission ${submissionId} in status='${currentStatus}' is not decidable`)
    this.name = 'SubmissionNotDecidableError'
  }
}

class ChecklistIncompleteError extends Error {
  constructor(public readonly missingKeys: string[]) {
    super(`Checklist incomplete; missing ${missingKeys.length} required key(s)`)
    this.name = 'ChecklistIncompleteError'
  }
}

class ConflictOfInterestError extends Error {
  constructor(public readonly submissionId: string) {
    super(`Reviewer participated as tenant_user on submission ${submissionId}`)
    this.name = 'ConflictOfInterestError'
  }
}

class UnknownChecklistKeyError extends Error {
  constructor(public readonly key: string) {
    super(`Checklist key '${key}' is not valid for this submission's tier`)
    this.name = 'UnknownChecklistKeyError'
  }
}

const idParamSchema = z.object({ id: z.string().uuid() })

// Default cursor decoder for paginated list — base64 of `${createdAt.toISOString()}|${id}`
function decodeCursor(cursor?: string): { createdAt: Date; id: string } | null {
  if (!cursor) return null
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8')
    const [iso, id] = decoded.split('|')
    if (!iso || !id) return null
    return { createdAt: new Date(iso), id }
  } catch {
    return null
  }
}

function encodeCursor(row: { createdAt: Date | null; id: string }): string {
  const iso = (row.createdAt ?? new Date()).toISOString()
  return Buffer.from(`${iso}|${row.id}`, 'utf-8').toString('base64url')
}

/**
 * Compute the count of checked items the reviewer has confirmed so
 * far, for the list-view progress indicator. Counts ANY checked key
 * (required or optional); the frontend displays it as "N items
 * verified" without asserting completeness.
 */
function countCheckedKeys(checklist: ReviewerChecklist | undefined): number {
  if (!checklist) return 0
  let n = 0
  for (const entry of Object.values(checklist)) {
    if (entry?.checked) n += 1
  }
  return n
}

// ─── GET /submissions — list view ─────────────────────────────────────
//
// No PII fields in response. Queue triage metadata only: tenant name +
// submission id + tier + status + submitted_at + checklist progress.
// Decision G: this endpoint does NOT write per-row audit rows.
// (A future operational telemetry row per request is fine but not
// shipped in this PR.)

admin.get('/submissions', zValidator('query', KycSubmissionListFilterSchema), async (c) => {
  const filter = c.req.valid('query')
  const requestId = c.req.header('x-request-id') ?? null

  try {
    const { rows, nextCursor } = await withSuperAdmin(async (tx) => {
      const cursor = decodeCursor(filter.cursor)

      const conditions = [eq(kycSubmissions.status, filter.status)]
      if (filter.tier) {
        conditions.push(eq(kycSubmissions.tierRequested, filter.tier))
      }
      if (filter.tenantId) {
        conditions.push(eq(kycSubmissions.tenantId, filter.tenantId))
      }
      // Cursor pagination: keyset on (createdAt DESC, id DESC) so newer
      // rows show first. The cursor encodes the LAST row's (createdAt, id)
      // and the next page is everything strictly before that.
      if (cursor) {
        conditions.push(
          or(
            lt(kycSubmissions.createdAt, cursor.createdAt),
            and(eq(kycSubmissions.createdAt, cursor.createdAt), lt(kycSubmissions.id, cursor.id)),
          )!,
        )
      }

      const rawRows = await tx
        .select({
          id: kycSubmissions.id,
          tenantId: kycSubmissions.tenantId,
          tenantName: tenants.name,
          tenantSlug: tenants.slug,
          submissionType: kycSubmissions.submissionType,
          tierRequested: kycSubmissions.tierRequested,
          status: kycSubmissions.status,
          createdAt: kycSubmissions.createdAt,
          updatedAt: kycSubmissions.updatedAt,
          reviewerChecklist: kycSubmissions.reviewerChecklist,
        })
        .from(kycSubmissions)
        .innerJoin(tenants, eq(kycSubmissions.tenantId, tenants.id))
        .where(and(...conditions))
        .orderBy(desc(kycSubmissions.createdAt), desc(kycSubmissions.id))
        .limit(filter.limit + 1)

      const hasMore = rawRows.length > filter.limit
      const page = hasMore ? rawRows.slice(0, filter.limit) : rawRows
      const last = page[page.length - 1]
      const nextCursor = hasMore && last ? encodeCursor(last) : null

      // Reshape to the list-view envelope. Deliberately strips
      // reviewerChecklist (per-key state) down to a count to keep PII +
      // reviewer-judgment data off the list response.
      const reshaped = page.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        tenantSlug: r.tenantSlug,
        submissionType: r.submissionType,
        tierRequested: r.tierRequested,
        status: r.status,
        submittedAt: r.createdAt,
        updatedAt: r.updatedAt,
        checkedKeyCount: countCheckedKeys(
          (r.reviewerChecklist as ReviewerChecklist | null) ?? undefined,
        ),
      }))

      return { rows: reshaped, nextCursor }
    })

    return c.json(envelope(rows, { nextCursor, hasMore: nextCursor !== null }))
  } catch (err) {
    logger.error({ err }, 'admin kyc submissions list failed')
    return c.json(errorEnvelope('INTERNAL_ERROR', 'failed to list submissions', requestId), 500)
  }
})

// ─── GET /submissions/:id — detail view (Decision G: writes audit) ─────

admin.get('/submissions/:id', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param')
  const auth = c.get('auth')!
  const requestId = c.req.header('x-request-id') ?? null
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = c.req.header('user-agent') ?? null

  try {
    const detail = await withSuperAdmin(async (tx) => {
      // Lock the row inside the tx so the self-claim race-condition
      // (two reviewers opening the same submitted row simultaneously)
      // serialises cleanly — the second open sees status='under_review'
      // and skips the transition.
      const rows = await tx
        .select()
        .from(kycSubmissions)
        .where(eq(kycSubmissions.id, id))
        .for('update')
        .limit(1)
      if (rows.length === 0) throw new SubmissionNotFoundError(id)
      const row = rows[0]!

      // Decision G: per-detail-view audit row.
      await writeKycSubmissionViewed(tx, {
        submissionId: id,
        tenantId: row.tenantId,
        actorUserId: auth.sub,
        ip,
        userAgent,
      })

      // Self-claim: if the submission is still in 'submitted', this
      // reviewer opening the detail page is the de-facto claim event.
      // Transition submitted → under_review and assign this reviewer.
      // The transition writes its own audit row via writeKycTransition.
      // No-op if already in under_review / approved / rejected / draft.
      if (row.status === 'submitted') {
        transition('submitted', 'under_review')
        const claimed = await tx
          .update(kycSubmissions)
          .set({
            status: 'under_review',
            reviewerId: auth.sub,
            updatedAt: new Date(),
          })
          .where(and(eq(kycSubmissions.id, id), eq(kycSubmissions.status, 'submitted')))
          .returning()
        if (claimed.length > 0) {
          await writeKycTransition(tx, {
            submissionId: id,
            tenantId: row.tenantId,
            fromState: 'submitted',
            toState: 'under_review',
            actorUserId: auth.sub,
            actorRole: 'super_admin',
            ip,
            userAgent,
          })
          return claimed[0]!
        }
      }

      return row
    })

    // Sign all document URIs for inline preview. Done outside the tx
    // because (a) signing is async-network-free, (b) tx duration should
    // stay short.
    const documents = (detail.documents ?? {}) as Record<string, string>
    const signedDocuments = await getKycSignedGetUrls(documents).catch((sigErr) => {
      logger.warn(
        { err: sigErr, submissionId: id },
        'failed to sign one or more KYC document URLs; returning detail without signed URLs',
      )
      return {} as Record<string, never>
    })

    return c.json(
      envelope({
        ...detail,
        signedDocuments,
      }),
    )
  } catch (err) {
    if (err instanceof SubmissionNotFoundError) {
      return c.json(errorEnvelope('NOT_FOUND', 'submission not found', requestId), 404)
    }
    logger.error({ err, submissionId: id }, 'admin kyc submission detail failed')
    return c.json(errorEnvelope('INTERNAL_ERROR', 'failed to read submission', requestId), 500)
  }
})

// ─── PATCH /submissions/:id/checklist — toggle one key ─────────────────

admin.patch(
  '/submissions/:id/checklist',
  zValidator('param', idParamSchema),
  zValidator('json', ReviewerChecklistTogglePatchSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const patch = c.req.valid('json')
    const auth = c.get('auth')!
    const requestId = c.req.header('x-request-id') ?? null
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const userAgent = c.req.header('user-agent') ?? null

    try {
      const updated = await withSuperAdmin(async (tx) => {
        const rows = await tx
          .select()
          .from(kycSubmissions)
          .where(eq(kycSubmissions.id, id))
          .for('update')
          .limit(1)
        if (rows.length === 0) throw new SubmissionNotFoundError(id)
        const row = rows[0]!

        // Validate key against the submission's tier vocabulary.
        const validKeys = requiredChecklistKeysFor(
          row.submissionType as 'individual' | 'organisation',
        )
        if (!validKeys.includes(patch.key)) {
          throw new UnknownChecklistKeyError(patch.key)
        }

        const checklist = (row.reviewerChecklist ?? {}) as ReviewerChecklist
        const priorChecked = checklist[patch.key]?.checked
        const nextChecklist: ReviewerChecklist = {
          ...checklist,
          [patch.key]: {
            checked: patch.checked,
            checkedAt: new Date().toISOString(),
            checkedBy: auth.sub,
          },
        }

        const updated = await tx
          .update(kycSubmissions)
          .set({ reviewerChecklist: nextChecklist, updatedAt: new Date() })
          .where(eq(kycSubmissions.id, id))
          .returning()
        if (updated.length === 0) {
          throw new SubmissionNotFoundError(id)
        }

        await writeKycChecklistToggled(tx, {
          submissionId: id,
          tenantId: row.tenantId,
          key: patch.key,
          checked: patch.checked,
          priorChecked,
          actorUserId: auth.sub,
          ip,
          userAgent,
        })

        return updated[0]!
      })
      return c.json(envelope(updated))
    } catch (err) {
      if (err instanceof SubmissionNotFoundError) {
        return c.json(errorEnvelope('NOT_FOUND', 'submission not found', requestId), 404)
      }
      if (err instanceof UnknownChecklistKeyError) {
        return c.json(
          errorEnvelope('VALIDATION_ERROR', `unknown checklist key: ${err.key}`, requestId),
          400,
        )
      }
      logger.error({ err, submissionId: id }, 'admin kyc checklist patch failed')
      return c.json(errorEnvelope('INTERNAL_ERROR', 'failed to update checklist', requestId), 500)
    }
  },
)

// ─── PATCH /submissions/:id/notes — update reviewer notes ──────────────

admin.patch(
  '/submissions/:id/notes',
  zValidator('param', idParamSchema),
  zValidator('json', ReviewerNotesPatchSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const patch = c.req.valid('json')
    const auth = c.get('auth')!
    const requestId = c.req.header('x-request-id') ?? null
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const userAgent = c.req.header('user-agent') ?? null

    try {
      const updated = await withSuperAdmin(async (tx) => {
        const rows = await tx
          .select()
          .from(kycSubmissions)
          .where(eq(kycSubmissions.id, id))
          .for('update')
          .limit(1)
        if (rows.length === 0) throw new SubmissionNotFoundError(id)
        const row = rows[0]!

        const priorNotes = row.reviewerNotes
        const updated = await tx
          .update(kycSubmissions)
          .set({ reviewerNotes: patch.notes, updatedAt: new Date() })
          .where(eq(kycSubmissions.id, id))
          .returning()
        if (updated.length === 0) {
          throw new SubmissionNotFoundError(id)
        }

        await writeKycNotesUpdated(tx, {
          submissionId: id,
          tenantId: row.tenantId,
          priorNotes,
          newNotes: patch.notes,
          actorUserId: auth.sub,
          ip,
          userAgent,
        })

        return updated[0]!
      })
      return c.json(envelope(updated))
    } catch (err) {
      if (err instanceof SubmissionNotFoundError) {
        return c.json(errorEnvelope('NOT_FOUND', 'submission not found', requestId), 404)
      }
      logger.error({ err, submissionId: id }, 'admin kyc notes patch failed')
      return c.json(errorEnvelope('INTERNAL_ERROR', 'failed to update notes', requestId), 500)
    }
  },
)

// ─── POST /submissions/:id/decide — approve | reject ──────────────────

admin.post(
  '/submissions/:id/decide',
  zValidator('param', idParamSchema),
  zValidator('json', ReviewerDecisionSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const decision = c.req.valid('json')
    const auth = c.get('auth')!
    const requestId = c.req.header('x-request-id') ?? null
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const userAgent = c.req.header('user-agent') ?? null

    try {
      const { row, transitionedNow } = await withSuperAdmin(async (tx) => {
        const rows = await tx
          .select()
          .from(kycSubmissions)
          .where(eq(kycSubmissions.id, id))
          .for('update')
          .limit(1)
        if (rows.length === 0) throw new SubmissionNotFoundError(id)
        const existing = rows[0]!

        // Idempotency: if already in the target terminal state, return
        // without writing a duplicate audit row or firing a duplicate
        // notification. Matches the Item 9 submit endpoint's pattern.
        const targetStatus = decision.action === 'approve' ? 'approved' : 'rejected'
        if (existing.status === targetStatus) {
          return { row: existing, transitionedNow: false }
        }
        // Decidable states: only 'under_review'. Reviewers self-claim
        // ('submitted' → 'under_review') by opening the detail view
        // (GET /submissions/:id). A direct decide call on 'submitted'
        // would skip the self-claim audit row and undermine Decision G's
        // "who's looked at this" trail. Force the reviewer through the
        // detail view first.
        if (existing.status !== 'under_review') {
          throw new SubmissionNotDecidableError(id, existing.status)
        }

        // Conflict-of-interest check: did this reviewer write a
        // tenant_user audit row for this submission previously? Backed
        // by the composite index on audit_logs(entity_type, entity_id,
        // actor_id) added in migration 0007.
        if (decision.action === 'approve') {
          const conflict = await tx
            .select({ id: auditLogs.id })
            .from(auditLogs)
            .where(
              and(
                eq(auditLogs.entityType, 'kyc_submission'),
                eq(auditLogs.entityId, id),
                eq(auditLogs.actorType, 'tenant_user'),
                eq(auditLogs.actorId, auth.sub),
              ),
            )
            .limit(1)
          if (conflict.length > 0) {
            throw new ConflictOfInterestError(id)
          }
        }

        // Server-enforced checklist completeness on approve (Decision I).
        if (decision.action === 'approve') {
          const required = requiredChecklistKeysFor(
            existing.submissionType as 'individual' | 'organisation',
          )
          const checklist = (existing.reviewerChecklist ?? {}) as ReviewerChecklist
          const missing = required.filter((k) => !checklist[k]?.checked)
          if (missing.length > 0) {
            throw new ChecklistIncompleteError(missing)
          }
        }

        // State machine: assert the transition is legal.
        transition(existing.status as never, targetStatus)

        const updateSet: Record<string, unknown> = {
          status: targetStatus,
          decidedAt: new Date(),
          reviewerId: auth.sub,
          updatedAt: new Date(),
        }
        if (decision.action === 'reject') {
          updateSet['decisionReason'] = decision.reason
        }

        const updatedRows = await tx
          .update(kycSubmissions)
          .set(updateSet)
          .where(and(eq(kycSubmissions.id, id), eq(kycSubmissions.status, 'under_review')))
          .returning()
        if (updatedRows.length === 0) {
          throw new SubmissionNotDecidableError(id, 'unknown')
        }
        const updated = updatedRows[0]!

        // Two audit rows on transition: the standard transition row
        // (existing writeKycTransition helper) + a decision-context
        // row (writeKycDecided) carrying the checklist snapshot.
        // The two together give the regulator both "what state
        // changed" and "what was true when it changed".
        await writeKycTransition(tx, {
          submissionId: id,
          tenantId: existing.tenantId,
          fromState: existing.status as never,
          toState: targetStatus,
          actorUserId: auth.sub,
          actorRole: 'super_admin',
          reason: decision.action === 'reject' ? decision.reason : null,
          ip,
          userAgent,
        })
        await writeKycDecided(tx, {
          submissionId: id,
          tenantId: existing.tenantId,
          decision: decision.action,
          reason: decision.action === 'reject' ? decision.reason : null,
          category: decision.action === 'reject' ? (decision.category ?? null) : null,
          checklistSnapshot: (existing.reviewerChecklist ?? {}) as ReviewerChecklist,
          actorUserId: auth.sub,
          ip,
          userAgent,
        })

        return { row: updated, transitionedNow: true }
      })

      // Notifications fire AFTER tx commits per the Item 9 pattern
      // (Day 14 /review finding #3 — prevent 500-after-commit on
      // notification failure once SES wiring lands in Item 16).
      if (transitionedNow) {
        const notifyArgs = { tenantId: row.tenantId, submissionId: id }
        const notifyPromise =
          decision.action === 'approve'
            ? sendKycApprovedNotice(notifyArgs)
            : sendKycRejectedNotice({
                ...notifyArgs,
                reason: decision.action === 'reject' ? decision.reason : '',
              })
        notifyPromise.catch((notifyErr) =>
          logger.error(
            { err: notifyErr, submissionId: id, decision: decision.action },
            'kyc decision notification failed (state change already committed)',
          ),
        )

        // Subdomain provisioning TODO-stubbed per Day 18 brief §2.5;
        // Item 16 (Day 20) wires SSM for actual Nginx vhost generation.
        if (decision.action === 'approve') {
          logger.info(
            { submissionId: id, tenantId: row.tenantId },
            '[STUB] tenant subdomain provisioning — wired at Item 16 (Day 20)',
          )
        }
      }

      return c.json(envelope(row))
    } catch (err) {
      if (err instanceof SubmissionNotFoundError) {
        return c.json(errorEnvelope('NOT_FOUND', 'submission not found', requestId), 404)
      }
      if (err instanceof SubmissionNotDecidableError) {
        return c.json(
          errorEnvelope(
            'CONFLICT',
            `cannot decide a submission in status='${err.currentStatus}'`,
            requestId,
          ),
          409,
        )
      }
      if (err instanceof ConflictOfInterestError) {
        return c.json(
          errorEnvelope(
            'CONFLICT_OF_INTEREST',
            'reviewer participated as tenant_user on this submission and cannot approve it',
            requestId,
          ),
          409,
        )
      }
      if (err instanceof ChecklistIncompleteError) {
        return c.json(
          errorEnvelope('CHECKLIST_INCOMPLETE', 'required checklist keys are missing', requestId, {
            missingKeys: err.missingKeys,
          }),
          409,
        )
      }
      logger.error({ err, submissionId: id }, 'admin kyc decide failed')
      return c.json(errorEnvelope('INTERNAL_ERROR', 'failed to decide submission', requestId), 500)
    }
  },
)

// Suppress unused-import lint warnings for symbols kept for future
// use. `isNull` + `asc` are imported here defensively because future
// filter additions (e.g. "show only un-claimed submissions") will use
// them. Removing them now would just bring them back in PR 4.
void isNull
void asc
void sql

export { admin as adminKycRoutes }

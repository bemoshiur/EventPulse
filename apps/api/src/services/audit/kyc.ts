/**
 * Audit helpers for KYC submission lifecycle — Sprint 2 Day 14 Item 9
 * (transitions) + Sprint 2 Day 16 Item 12 (draft create + draft update).
 *
 * Three sibling helpers live here, one per KYC audit-action:
 *
 *   • writeKycTransition       — state-machine transitions (submitted →
 *                                under_review → approved/rejected, plus
 *                                rejected → draft + draft → submitted)
 *   • writeKycDraftCreated     — wizard creates a row in status='draft'
 *                                (parallel path to Item 9's direct-
 *                                submit; documented in §4.2.1-style
 *                                state-machine comments below)
 *   • writeKycDraftUpdated     — wizard PATCHes a draft row's fields
 *                                or documents at a given step
 *
 * All three are KYC-domain; the one-per-domain audit-helper convention
 * (decisions.md 2026-05-17 reaffirmed 2026-05-18) is about per-domain
 * type safety on diff/metadata shapes, NOT one helper per domain.
 * Multiple helpers in the same domain file are fine and expected.
 *
 * All three are called inside an active transaction (`tx` from
 * withTenant) so the audit row and the kyc_submissions row mutation
 * commit atomically — a state change without its audit row, or vice-
 * versa, is a regulatory-review failure mode and the transaction
 * boundary is the only thing that prevents it.
 *
 * Audit row shape (per §9.10 + §1.3 R8):
 *   - tenant_id    : always populated from withTenant context.
 *                    System-action audit writes (tenant_id IS NULL)
 *                    require withSuperAdmin and a different helper.
 *   - actor_type   : 'tenant_user' (tenant resubmit) or 'super_admin'
 *                    (reviewer approve/reject). Item 9 ships the
 *                    tenant_user path only; reviewer writes land at
 *                    Item 13 (Day 18) and call back into this helper.
 *   - actor_id     : the user id of the actor (never null for KYC).
 *   - action       : 'kyc_submission.transition' — namespaced so a
 *                    future entity_type=order audit shares the
 *                    'transition' verb without colliding.
 *   - entity_type  : 'kyc_submission'
 *   - entity_id    : the submission id (matches kyc_submissions.id).
 *   - diff         : { from, to, reason? } — reason populated on rejection.
 *   - metadata     : { actor_role } — captured for forensic queries that
 *                    need to know "which role acted" without joining
 *                    back to a stale roles table.
 *   - ip, user_agent: from the request when available (route handler
 *                    passes through; null in test/system paths).
 *
 * No-PII rule: nothing in this row carries raw PII. The submission's
 * NID / eTIN / bank details live in kyc_submissions.fields; the audit
 * trail references the submission by id only. Per §1.3 R5.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { auditLogs } from '../../db/schema/index.js'
import type { KycSubmissionStatus } from '../../domain/kyc/state-machine.js'

/**
 * Subset of `audit_logs.actor_type` (§9.10 CHECK enum:
 *   'user' | 'tenant_user' | 'super_admin' | 'system' | 'webhook'
 * ) that the KYC code path can ever emit. We deliberately narrow:
 *
 *   - `tenant_user` — tenant resubmit / tenant-side create writes.
 *   - `super_admin` — reviewer approve/reject writes (lands at Item 13).
 *
 * The other DB-legal values ('user', 'system', 'webhook') belong to
 * future writers (`user` for /my/* self-service writes, `system` for
 * cron-driven retention sweeps, `webhook` for EPS callbacks). Those
 * writers ship their own helpers; we don't widen this type unless KYC
 * code actually needs to write rows with those actor_types, which
 * would be a meaningful design change worth surfacing.
 */
export type KycAuditActorRole = 'tenant_user' | 'super_admin'

export interface WriteKycTransitionInput {
  /** UUID of the kyc_submissions row whose state is changing. */
  submissionId: string
  /** Tenant id — must equal `app.current_tenant_id` for the RLS insert to pass. */
  tenantId: string
  /** Previous status; null only when the audit is logging the row's birth
   *  (status='submitted' on first write). Convention: pass null on create,
   *  pass the old state on every subsequent transition.
   */
  fromState: KycSubmissionStatus | null
  /** Destination status. */
  toState: KycSubmissionStatus
  /** UUID of the user who acted. */
  actorUserId: string
  /** Which surface they acted from. */
  actorRole: KycAuditActorRole
  /** Required on rejection, optional otherwise. */
  reason?: string | null
  /** Request IP, if available. */
  ip?: string | null
  /** Request user-agent, if available. */
  userAgent?: string | null
}

type Tx = NodePgDatabase<Record<string, unknown>>

export async function writeKycTransition(tx: Tx, input: WriteKycTransitionInput): Promise<void> {
  // The `KycAuditActorRole` type is intentionally a subset of the DB
  // CHECK enum (see type comment above), so passing `actorRole` straight
  // through as `actor_type` is always legal at the DB level.
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: input.actorRole,
    actorId: input.actorUserId,
    action: 'kyc_submission.transition',
    entityType: 'kyc_submission',
    entityId: input.submissionId,
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

// ─── writeKycDraftCreated (Day 16 Item 12) ────────────────────────────
//
// Birth audit for a wizard-created draft row. Sibling to
// writeKycTransition; the row is born in status='draft' (not 'submitted'
// as Item 9's direct-submit endpoint does), so its birth event has its
// own action verb to keep audit queries clean:
//
//   action='kyc_submission.draft_created'  → wizard create
//   action='kyc_submission.transition' with from=null, to='submitted'
//                                          → direct-submit (Item 9)
//   action='kyc_submission.transition' with from='draft', to='submitted'
//                                          → wizard final submit (Day 16)
//
// A future analyst pulling "all submissions created via the wizard" can
// filter on action='kyc_submission.draft_created'; "all submissions
// finalised via the wizard" filters on action='kyc_submission.transition'
// AND diff.from='draft'.

export interface WriteKycDraftCreatedInput {
  submissionId: string
  tenantId: string
  submissionType: 'individual' | 'organisation'
  tierRequested: string
  actorUserId: string
  actorRole: KycAuditActorRole
  ip?: string | null
  userAgent?: string | null
}

export async function writeKycDraftCreated(
  tx: Tx,
  input: WriteKycDraftCreatedInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: input.actorRole,
    actorId: input.actorUserId,
    action: 'kyc_submission.draft_created',
    entityType: 'kyc_submission',
    entityId: input.submissionId,
    // No PII in the diff. Type + tier are non-PII metadata that helps
    // forensic queries scope by wizard variant.
    diff: {
      submission_type: input.submissionType,
      tier_requested: input.tierRequested,
    },
    metadata: { actor_role: input.actorRole },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}

// ─── writeKycDraftUpdated (Day 16 Item 12) ────────────────────────────
//
// Per-PATCH audit for a draft row's fields/documents update. Sibling to
// writeKycTransition; one row per PATCH request, not per field.
//
// Diff shape (per decisions.md 2026-05-18 "KYC wizard uses server-side
// drafts"):
//
//   diff = {
//     fields: {
//       added:   [<dot-path strings>],
//       updated: [<dot-path strings>],
//       removed: [<dot-path strings>]
//     }
//   }
//
//   metadata = { actor_role, step: 'identity' | 'address' | 'financial' | ... }
//
// PATHS, NOT VALUES. The wizard's field values live in kyc_submissions.
// {fields,documents}; reproducing them in the audit table would (a)
// duplicate PII (violating §1.3 R5), (b) double the storage footprint of
// the most-PII-dense table in the system. The path-only diff still lets
// a forensic reviewer answer "what was edited in which order" without
// re-storing the secret.
//
// Path syntax: dot-notation matching the jsonb structure. Examples:
//   "fields.identity.fullName"      → text field at fields.identity.fullName
//   "fields.address.division"       → enum field
//   "documents.nid_front"           → S3 URI for the NID front upload
//
// Arrays / wildcards not used at this stage (Tier 1 + Tier A schemas
// have no array-shaped fields). If a future tier introduces lists,
// extend the path convention with `[N]` indices at that point.

export interface KycDraftDiff {
  fields: {
    added: string[]
    updated: string[]
    removed: string[]
  }
}

export type KycDraftStep = 'identity' | 'address' | 'financial'

export interface WriteKycDraftUpdatedInput {
  submissionId: string
  tenantId: string
  /** Which wizard step the PATCH targeted. Used for filtered audit queries. */
  step: KycDraftStep
  diff: KycDraftDiff
  actorUserId: string
  actorRole: KycAuditActorRole
  ip?: string | null
  userAgent?: string | null
}

export async function writeKycDraftUpdated(
  tx: Tx,
  input: WriteKycDraftUpdatedInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: input.actorRole,
    actorId: input.actorUserId,
    action: 'kyc_submission.draft_updated',
    entityType: 'kyc_submission',
    entityId: input.submissionId,
    diff: input.diff,
    metadata: { actor_role: input.actorRole, step: input.step },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}

// ─── Diff helpers (pure functions) ────────────────────────────────────
//
// Used by the drafts router to compute the field-path diff before
// writing the audit row. Pure functions so they can be unit-tested
// without DB.

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * Walk a jsonb-shaped object and return all leaf paths in dot notation.
 * Arrays are not expanded — they're treated as leaf values (Tier 1 +
 * Tier A schemas have no array-shaped fields).
 *
 * Example: `flattenPaths({ identity: { fullName: 'X' } }, 'fields')`
 *   returns `['fields.identity.fullName']`.
 */
export function flattenPaths(value: JsonValue | undefined, prefix: string): string[] {
  if (value === undefined || value === null) return []
  if (typeof value !== 'object' || Array.isArray(value)) return [prefix]
  const out: string[] = []
  for (const [k, v] of Object.entries(value)) {
    out.push(...flattenPaths(v as JsonValue, prefix ? `${prefix}.${k}` : k))
  }
  return out
}

/**
 * Compute a draft-update diff (added/updated/removed paths) given the
 * before/after snapshots of the field tree at the level being PATCHed.
 *
 * Pass `prefix='fields.identity'` etc. so the resulting paths are
 * absolute from the row level (`fields.identity.fullName`, not
 * `fullName`).
 */
export function computeFieldDiff(
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  prefix: string,
): { added: string[]; updated: string[]; removed: string[] } {
  const beforePaths = new Set(flattenPaths(before, prefix))
  const afterPaths = new Set(flattenPaths(after, prefix))
  const added: string[] = []
  const updated: string[] = []
  const removed: string[] = []
  for (const p of afterPaths) {
    if (!beforePaths.has(p)) added.push(p)
    else if (!deepEqualAt(before, after, p, prefix)) updated.push(p)
  }
  for (const p of beforePaths) {
    if (!afterPaths.has(p)) removed.push(p)
  }
  return { added, updated, removed }
}

function getAtPath(
  obj: JsonValue | undefined,
  path: string,
  prefix: string,
): JsonValue | undefined {
  if (obj === undefined || obj === null) return undefined
  const rel = prefix && path.startsWith(prefix + '.') ? path.slice(prefix.length + 1) : path
  if (!rel) return obj
  const parts = rel.split('.')
  let cur: JsonValue | undefined = obj
  for (const part of parts) {
    if (cur === undefined || cur === null || typeof cur !== 'object' || Array.isArray(cur))
      return undefined
    cur = (cur as { [key: string]: JsonValue })[part]
  }
  return cur
}

function deepEqualAt(
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  path: string,
  prefix: string,
): boolean {
  return (
    JSON.stringify(getAtPath(before, path, prefix)) ===
    JSON.stringify(getAtPath(after, path, prefix))
  )
}

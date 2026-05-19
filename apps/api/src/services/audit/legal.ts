/**
 * Audit helpers for the Trust Center / Legal & Trust editor — Sprint 2
 * Day 19 Item 15.
 *
 * One helper for now (`writeLegalVersionPublished`); sibling helpers
 * (`writeLegalVersionRerendered` for the Decision-J allowlist-widening
 * maintenance flow, `writeLegalVersionEdited` for in-progress draft
 * saves once we add a draft-state column) can join later. Multiple
 * helpers in the same domain file are fine — the one-per-domain
 * convention is about per-domain type safety on diff/metadata shapes,
 * NOT one-helper-per-file.
 *
 * Called inside an active transaction (`tx`) so the audit row commits
 * atomically with the version INSERT + the `legal_documents.current_
 * version_id` bump. A published version without its audit row, or vice-
 * versa, is a regulator-facing audit-trail failure mode.
 *
 * Audit row shape (per §9.10 + §1.3 R8):
 *   - tenant_id    : NULL — legal documents are platform-global. The
 *                    audit row is a system-action row per migration 0005's
 *                    "tenant_id IS NULL ⇒ withSuperAdmin context only"
 *                    contract.
 *   - actor_type   : 'super_admin' (only super-admins publish legal docs).
 *   - actor_id     : publishing super-admin user id.
 *   - action       : 'legal_document_version.published'
 *   - entity_type  : 'legal_document_version'
 *   - entity_id    : the new version_id.
 *   - diff         : { documentSlug, fromVersion, toVersion,
 *                      materialChange, summaryOfChanges }
 *   - metadata     : { documentId, canonicalUrlPath, effectiveAt }
 *   - ip, user_agent : passed through from the request when available.
 *
 * No-PII rule (§1.3 R5): nothing in this row carries raw PII. The
 * version body lives in `legal_document_versions.body_md`/`body_html`
 * and is referenced by id only.
 *
 * @see .claude/memory/decisions.md "audit_logs scope at Item 9 — KYC
 *   transitions only; auth events + S3 issuance backfill deferred"
 *   (2026-05-17, reaffirmed 2026-05-18) for the one-per-domain rule.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { auditLogs } from '../../db/schema/index.js'

type Tx = NodePgDatabase<Record<string, unknown>>

export interface WriteLegalVersionPublishedInput {
  /** UUID of the just-INSERTed legal_document_versions row. */
  versionId: string
  /** UUID of the legal_documents row this version belongs to. */
  documentId: string
  /** Slug of the document (e.g. 'privacy', 'security-disclosure'). */
  documentSlug: string
  /** Public URL path of the document (e.g. '/privacy'). */
  canonicalUrlPath: string
  /** Prior `current_version_id` version string, or null for first publish. */
  fromVersion: string | null
  /** The version string just published (e.g. 'v0.1', 'v1.0.0'). */
  toVersion: string
  /** Effective timestamp of the published version. */
  effectiveAt: Date
  /** Whether this publish is flagged as a material change (§20.4 trigger). */
  materialChange: boolean
  /** Optional human-readable summary of the change. Stored verbatim. */
  summaryOfChanges: string | null
  /** Publishing super-admin user id. */
  actorUserId: string
  /** Request IP if known; null in test/system paths. */
  ip?: string | null
  /** Request user-agent if known; null in test/system paths. */
  userAgent?: string | null
}

/**
 * Append the canonical audit row for a Legal & Trust editor publish.
 *
 * Must be called inside an active super-admin transaction
 * (`withSuperAdmin(...)`). The `tenant_id` column is left NULL because
 * legal documents are platform-global — per migration 0005's RLS policy,
 * system-action rows are visible only via withSuperAdmin and writable
 * only under BYPASSRLS context.
 */
export async function writeLegalVersionPublished(
  tx: Tx,
  input: WriteLegalVersionPublishedInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: null,
    actorType: 'super_admin',
    actorId: input.actorUserId,
    action: 'legal_document_version.published',
    entityType: 'legal_document_version',
    entityId: input.versionId,
    diff: {
      documentSlug: input.documentSlug,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      materialChange: input.materialChange,
      summaryOfChanges: input.summaryOfChanges,
    },
    metadata: {
      documentId: input.documentId,
      canonicalUrlPath: input.canonicalUrlPath,
      effectiveAt: input.effectiveAt.toISOString(),
    },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}

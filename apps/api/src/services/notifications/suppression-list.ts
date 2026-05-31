/**
 * Email suppression list — Day 39 Phase 4.
 *
 * Global (cross-tenant) suppression table consulted by the outbound-
 * send guard before any SES SendEmail call. Bounce/complaint events
 * arriving via SNS webhooks (apps/api/src/routes/webhooks/ses-bounce.ts
 * + ses-complaint.ts) write entries here; the SES client (apps/api/
 * src/infra/ses/client.ts) reads here on every send.
 *
 * Per the AWS Support case 177899559700777 pre-launch commitment
 * (decisions.md 2026-05-31 SES entry): this wiring MUST exist before
 * MAIL_DRY_RUN=0 is flipped in production.
 *
 * Read path runs under withSuperAdmin (BYPASSRLS) — no tenant context
 * on a transactional send, and the table is platform-wide.
 *
 * Write path is the SNS webhook handler's concern; it also runs under
 * withSuperAdmin (the webhook payload has no tenant context either).
 */

import { createHash } from 'crypto'

import { eq, gt, isNull, or, sql } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { emailSuppressionList } from '../../db/schema/index.js'

export type SuppressionReason =
  | 'hard_bounce'
  | 'complaint'
  | 'soft_bounce_temporary'
  | 'soft_bounce_promoted'

export interface UpsertSuppressionInput {
  email: string
  reason: SuppressionReason
  /** SNS Message id for traceability. */
  sourceMessageId?: string | null
  /**
   * For soft_bounce_temporary: future timestamp until which the address
   * is suppressed. For permanent reasons (hard_bounce / complaint /
   * soft_bounce_promoted) pass `null`.
   */
  suppressedUntil?: Date | null
  notes?: string | null
}

/**
 * Compute the deterministic hash for log/audit references. SHA-256 of
 * the lowercased email. Application code should log the hash, not
 * the raw address, per §1.3 R5.
 */
export function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

/**
 * Insert-or-update suppression record. Hard bounce / complaint events
 * OVERRIDE soft-bounce-temporal records (suppressed_until becomes
 * NULL); soft bounces that arrive after a permanent suppression are
 * ignored at the application layer by checking the current row's
 * reason before writing — but the simpler default is "latest write
 * wins" which is what this function implements. The webhook handler
 * is responsible for not downgrading permanent → temporary.
 */
export async function upsertSuppression(input: UpsertSuppressionInput): Promise<void> {
  const email = input.email.trim().toLowerCase()
  const emailHash = hashEmail(email)

  await withSuperAdmin(async (db) => {
    await db
      .insert(emailSuppressionList)
      .values({
        email,
        emailHash,
        reason: input.reason,
        sourceMessageId: input.sourceMessageId ?? null,
        suppressedUntil: input.suppressedUntil ?? null,
        notes: input.notes ?? null,
      })
      .onConflictDoUpdate({
        target: emailSuppressionList.email,
        set: {
          reason: input.reason,
          sourceMessageId: input.sourceMessageId ?? null,
          suppressedUntil: input.suppressedUntil ?? null,
          notes: input.notes ?? null,
          updatedAt: new Date(),
        },
      })
  })
}

/**
 * Returns true iff the email is currently suppressed (either by a
 * permanent reason OR by a soft-bounce-temporary whose
 * suppressed_until is still in the future). Returns false when the
 * address has no record OR a temporary suppression that has expired.
 *
 * Used by the outbound-send guard on every SES SendEmail call. Hot
 * path; index `idx_email_suppression_until` keeps the scan fast.
 */
export async function isSuppressed(email: string): Promise<boolean> {
  const normalised = email.trim().toLowerCase()

  return withSuperAdmin(async (db) => {
    const rows = await db
      .select({ suppressedUntil: emailSuppressionList.suppressedUntil })
      .from(emailSuppressionList)
      .where(
        sql`${emailSuppressionList.email} = ${normalised} AND (${emailSuppressionList.suppressedUntil} IS NULL OR ${emailSuppressionList.suppressedUntil} > now())`,
      )
      .limit(1)
    return rows.length > 0
  })
}

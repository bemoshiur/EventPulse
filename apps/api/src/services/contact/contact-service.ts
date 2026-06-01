/**
 * Contact form submission service — Day 42 Sprint 4 §26.1 Day 9 part 2.
 *
 * Backs the public POST /api/v1/public/contact endpoint. Writes a row
 * to `contact_submissions` under withSuperAdmin (the table is platform-
 * wide, no RLS — access is application-layer-only per migration 0017).
 *
 * Honeypot + per-IP rate limiting live at the route layer. This service
 * is the persistence + minimal-validation seam.
 */

import { withSuperAdmin } from '../../db/client.js'
import { contactSubmissions } from '../../db/schema/index.js'
import { logger } from '../../lib/logger.js'

export type ContactTopic =
  | 'sales'
  | 'support'
  | 'legal'
  | 'partnership'
  | 'press'
  | 'security'
  | 'other'

export interface ContactSubmissionInput {
  name: string
  email: string
  phone?: string | null
  organisation?: string | null
  subject: string
  message: string
  topic?: ContactTopic | null
  ip?: string | null
  userAgent?: string | null
}

export type ContactSubmissionResult =
  | { kind: 'created'; submissionId: string }
  | { kind: 'failed'; reason: string }

export async function submitContactForm(
  input: ContactSubmissionInput,
): Promise<ContactSubmissionResult> {
  try {
    const id = await withSuperAdmin(async (tx) => {
      const rows = await tx
        .insert(contactSubmissions)
        .values({
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          organisation: input.organisation ?? null,
          subject: input.subject,
          message: input.message,
          topic: input.topic ?? null,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        })
        .returning({ id: contactSubmissions.id })
      return rows[0]?.id
    })

    if (!id) {
      logger.error({ topic: input.topic }, 'contact.submission.insert_returned_no_id')
      return { kind: 'failed', reason: 'insert_returned_no_id' }
    }

    // No PII (no raw email/name) per §1.3 R5 — log topic only.
    logger.info(
      { submissionId: id, topic: input.topic ?? 'unspecified' },
      'contact.submission.created',
    )

    return { kind: 'created', submissionId: id }
  } catch (err) {
    logger.error({ err }, 'contact.submission.insert_failed')
    return { kind: 'failed', reason: 'insert_failed' }
  }
}

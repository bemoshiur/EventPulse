/**
 * notification_log row builder (§9.10, migration 0020).
 *
 * Maps each outbound send into a notification_log insert row. The recipient is
 * HASHED (sha256(lower(email)) via `hashEmail`) before storage — the raw
 * address is never persisted here (§1.3 R5). The delivery worker collects send
 * records during fan-out and inserts the built rows inside its existing
 * withSuperAdmin transaction, so the delivery audit + notification log commit
 * atomically.
 */

import { hashEmail } from './suppression-list.js'

export type NotificationStatus = 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed'

export interface SentEmailRecord {
  /** Raw recipient email — hashed before it reaches a row. */
  recipient: string
  /** Template id (e.g. 'order_confirmed', 'attendee_ticket'). */
  templateId: string
  /** Provider (SES) message id returned by the send. */
  providerMessageId: string
  /** Defaults to 'sent' (we only build rows after a successful send). */
  status?: NotificationStatus
}

export interface NotificationLogRow {
  tenantId: string | null
  channel: 'email'
  templateId: string
  recipientHash: string
  provider: 'ses'
  providerMessageId: string
  status: NotificationStatus
}

export function buildEmailNotificationRows(
  records: readonly SentEmailRecord[],
  tenantId: string | null,
): NotificationLogRow[] {
  return records.map((r) => ({
    tenantId,
    channel: 'email',
    templateId: r.templateId,
    recipientHash: hashEmail(r.recipient),
    provider: 'ses',
    providerMessageId: r.providerMessageId,
    status: r.status ?? 'sent',
  }))
}

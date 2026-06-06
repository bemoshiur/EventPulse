import { describe, expect, it } from 'vitest'

import { hashEmail } from './suppression-list.js'
import { buildEmailNotificationRows } from './notification-log.js'

describe('buildEmailNotificationRows', () => {
  it('maps a send record to a notification_log row with the recipient HASHED, not raw', () => {
    const rows = buildEmailNotificationRows(
      [
        {
          recipient: 'buyer@example.com',
          templateId: 'order_confirmed',
          providerMessageId: 'ses-1',
        },
      ],
      'tenant-uuid',
    )
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.recipientHash).toBe(hashEmail('buyer@example.com'))
    // R5 — the raw recipient must never appear in the stored row.
    expect(JSON.stringify(row)).not.toContain('buyer@example.com')
    expect(row).toMatchObject({
      tenantId: 'tenant-uuid',
      channel: 'email',
      provider: 'ses',
      templateId: 'order_confirmed',
      providerMessageId: 'ses-1',
      status: 'sent',
    })
  })

  it('defaults status to "sent" but honours an explicit status', () => {
    const rows = buildEmailNotificationRows(
      [
        { recipient: 'a@x.com', templateId: 't', providerMessageId: 'm1' },
        { recipient: 'b@x.com', templateId: 't', providerMessageId: 'm2', status: 'failed' },
      ],
      null,
    )
    expect(rows[0]!.status).toBe('sent')
    expect(rows[1]!.status).toBe('failed')
    // tenantId passes through as null for system/non-tenant sends.
    expect(rows[0]!.tenantId).toBeNull()
  })

  it('returns an empty array for no records (nothing to insert)', () => {
    expect(buildEmailNotificationRows([], 'tenant')).toEqual([])
  })
})

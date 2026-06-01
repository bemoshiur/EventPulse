/**
 * SES complaint webhook — Day 39 Phase 4.
 *
 * Sister to ses-bounce.ts. Complaints (recipient marked the email as
 * spam) are always permanent suppressions — there is no "transient
 * complaint" classification from AWS. Suppression reason is
 * 'complaint'; suppressed_until = NULL.
 *
 * **Why complaints matter more than bounces:** AWS revokes SES
 * production access if complaint rate exceeds 0.1% (the Day 38 SES
 * decision quotes this verbatim). One complaint per 1000 sends caps
 * the platform's reputation. Suppressing complaint addresses
 * immediately is critical.
 *
 * Same architecture as ses-bounce.ts:
 *   - signature verification first
 *   - confirmation messages handled
 *   - notification → parse Message JSON → upsert suppression
 *   - all failures return 200 (SNS retry-storm avoidance)
 */

import { Hono } from 'hono'

import {
  isSafeSnsActionUrl,
  verifySnsSignature,
  type SnsMessage,
} from '../../infra/sns/verify-signature.js'
import { logger } from '../../lib/logger.js'
import { hashEmail, upsertSuppression } from '../../services/notifications/suppression-list.js'

export const sesComplaintRoutes = new Hono()

/** Mirror of allowedBounceTopicArns from ses-bounce.ts; env var is the complaint-topic variant. */
function allowedComplaintTopicArns(): string[] {
  const raw = process.env['SES_COMPLAINT_TOPIC_ARNS']
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

interface SesComplaintMessage {
  notificationType: 'Complaint'
  complaint: {
    complainedRecipients: Array<{ emailAddress: string }>
    timestamp: string
    feedbackId: string
    complaintFeedbackType?: string
  }
}

async function fetchUrl(url: string): Promise<void> {
  await fetch(url, { method: 'GET' })
}

sesComplaintRoutes.post('/', async (c) => {
  let body: SnsMessage
  try {
    body = (await c.req.json()) as SnsMessage
  } catch {
    logger.warn({ webhook: 'ses-complaint' }, 'webhook.body.malformed_json')
    return c.json({ ok: true, ignored: 'malformed' })
  }

  const verify = await verifySnsSignature(body, undefined, {
    allowedTopicArns: allowedComplaintTopicArns(),
  })
  if (verify.kind !== 'verified') {
    // Include topicArn — see ses-bounce.ts for rationale (same gap).
    logger.warn(
      {
        webhook: 'ses-complaint',
        verify: verify.kind,
        topicArn: body.TopicArn,
        messageId: body.MessageId,
      },
      'webhook.sig.failed',
    )
    return c.json({ ok: true, ignored: 'signature_failed' })
  }

  if (body.Type === 'SubscriptionConfirmation' && body.SubscribeURL) {
    if (!isSafeSnsActionUrl(body.SubscribeURL)) {
      logger.warn(
        { webhook: 'ses-complaint', subscribeUrl: body.SubscribeURL },
        'webhook.sns.subscribe_url_unsafe',
      )
      return c.json({ ok: true, ignored: 'subscribe_url_unsafe' })
    }
    logger.info(
      { webhook: 'ses-complaint', topicArn: body.TopicArn },
      'webhook.sns.subscription_confirm',
    )
    try {
      await fetchUrl(body.SubscribeURL)
    } catch (err) {
      logger.warn({ err, webhook: 'ses-complaint' }, 'webhook.sns.subscribe_url_fetch_failed')
    }
    return c.json({ ok: true, action: 'subscription_confirmed' })
  }

  if (body.Type === 'UnsubscribeConfirmation' && body.UnsubscribeURL) {
    if (!isSafeSnsActionUrl(body.UnsubscribeURL)) {
      logger.warn(
        { webhook: 'ses-complaint', unsubscribeUrl: body.UnsubscribeURL },
        'webhook.sns.unsubscribe_url_unsafe',
      )
      return c.json({ ok: true, ignored: 'unsubscribe_url_unsafe' })
    }
    logger.info(
      { webhook: 'ses-complaint', topicArn: body.TopicArn },
      'webhook.sns.unsubscribe_confirm',
    )
    try {
      await fetchUrl(body.UnsubscribeURL)
    } catch (err) {
      logger.warn({ err, webhook: 'ses-complaint' }, 'webhook.sns.unsubscribe_url_fetch_failed')
    }
    return c.json({ ok: true, action: 'unsubscribe_confirmed' })
  }

  if (body.Type !== 'Notification') {
    return c.json({ ok: true, ignored: `unknown_type:${body.Type}` })
  }

  let sesPayload: SesComplaintMessage
  try {
    sesPayload = JSON.parse(body.Message) as SesComplaintMessage
  } catch {
    logger.warn(
      { webhook: 'ses-complaint', messageId: body.MessageId },
      'webhook.ses.message_unparseable',
    )
    return c.json({ ok: true, ignored: 'message_unparseable' })
  }
  if (sesPayload.notificationType !== 'Complaint') {
    return c.json({ ok: true, ignored: `not_a_complaint:${sesPayload.notificationType}` })
  }

  let suppressedCount = 0
  for (const recipient of sesPayload.complaint.complainedRecipients) {
    if (!recipient.emailAddress) continue
    try {
      await upsertSuppression({
        email: recipient.emailAddress,
        reason: 'complaint',
        sourceMessageId: body.MessageId,
        suppressedUntil: null,
        notes: sesPayload.complaint.complaintFeedbackType ?? null,
      })
      suppressedCount++
      logger.info(
        {
          webhook: 'ses-complaint',
          messageId: body.MessageId,
          emailHash: hashEmail(recipient.emailAddress),
        },
        'webhook.ses.complaint.suppressed',
      )
    } catch (err) {
      logger.error(
        { err, webhook: 'ses-complaint', messageId: body.MessageId },
        'webhook.ses.complaint.suppress_failed',
      )
    }
  }

  return c.json({ ok: true, action: 'suppressed', count: suppressedCount })
})

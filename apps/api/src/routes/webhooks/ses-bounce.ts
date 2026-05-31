/**
 * SES bounce webhook — Day 39 Phase 4.
 *
 * AWS SNS → HTTPS POST to this endpoint with bounce notifications
 * from SES (routed via the SES Configuration Set's event destinations).
 * Per the AWS Support case 177899559700777 pre-launch commitment:
 * this handler MUST exist before MAIL_DRY_RUN=0.
 *
 * Three SNS message types arrive:
 *
 *   - SubscriptionConfirmation — first message; we MUST hit the
 *     SubscribeURL to confirm. AWS won't send notifications until
 *     this completes.
 *   - Notification — bounce events. Parse Message JSON; extract
 *     bounced recipients + bounceType (Permanent vs Transient); write
 *     to suppression_list.
 *   - UnsubscribeConfirmation — rare; AWS sent when a topic is being
 *     deleted. We hit UnsubscribeURL to acknowledge.
 *
 * ALL THREE require signature verification first (verify-signature.ts).
 *
 * **Why this is a public-but-signed endpoint:** the SNS topic posts
 * unauthenticated; the signature is the auth. There is NO API token,
 * no AWS Sigv4 — the X.509 signature on the body is the entire
 * security model. The verifier blocks all forgery vectors via the
 * narrow host-whitelist + signature check.
 *
 * **Body fast-fail:** if signature verification fails, return 200 OK
 * (NOT 4xx). SNS aggressively retries on non-2xx responses and we
 * don't want to amplify a forged message into a DoS pattern. The
 * signature failure is logged + dropped.
 *
 * **Rate limit:** AWS sends at most a few bounces per second per
 * topic; per-IP rate limit not needed (the signed-payload check is
 * the meaningful gate).
 *
 * **AWS-side wiring NOT done by this PR:** SNS topic creation +
 * subscription + SES Configuration Set + IAM policy are all STOP-ASK
 * gated per Day 39 Phase 4 prompt. This code ships ready; the AWS
 * resources land in a separate operator-authorised session.
 */

import { Hono } from 'hono'

import {
  isSafeSnsActionUrl,
  verifySnsSignature,
  type SnsMessage,
} from '../../infra/sns/verify-signature.js'
import { logger } from '../../lib/logger.js'
import {
  hashEmail,
  upsertSuppression,
  type SuppressionReason,
} from '../../services/notifications/suppression-list.js'

export const sesBounceRoutes = new Hono()

/**
 * Allowlist of expected bounce-topic ARNs sourced from env. The env
 * var is comma-separated to support multiple environments (staging +
 * prod) sharing the same code path while pointing at distinct topics.
 * When unset, returns an empty array — verifySnsSignature then rejects
 * ALL messages (fail-closed before AWS-side wiring lands).
 */
function allowedBounceTopicArns(): string[] {
  const raw = process.env['SES_BOUNCE_TOPIC_ARNS']
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

interface SesBounceMessage {
  notificationType: 'Bounce'
  bounce: {
    bounceType: 'Permanent' | 'Transient' | 'Undetermined'
    bounceSubType?: string
    bouncedRecipients: Array<{ emailAddress: string; diagnosticCode?: string }>
    timestamp: string
    feedbackId: string
  }
}

/** Map AWS bounceType to our SuppressionReason enum. */
function bounceTypeToReason(bounceType: string): SuppressionReason {
  if (bounceType === 'Permanent') return 'hard_bounce'
  if (bounceType === 'Transient') return 'soft_bounce_temporary'
  // Undetermined → treat as soft (cautious; doesn't permanently nuke).
  return 'soft_bounce_temporary'
}

/** Soft-bounce suppression window — 24 hours. */
const SOFT_BOUNCE_SUPPRESS_HOURS = 24

async function fetchUrl(url: string): Promise<void> {
  // AWS SubscribeURL / UnsubscribeURL — a simple GET fulfills the
  // confirmation. Discard response body.
  await fetch(url, { method: 'GET' })
}

sesBounceRoutes.post('/', async (c) => {
  let body: SnsMessage
  try {
    body = (await c.req.json()) as SnsMessage
  } catch {
    logger.warn({ webhook: 'ses-bounce' }, 'webhook.body.malformed_json')
    // Return 200 — SNS shouldn't retry on our parse failures.
    return c.json({ ok: true, ignored: 'malformed' })
  }

  // Signature verification + topic-allowlist + freshness — the entire
  // auth boundary. TopicArn allowlist runs BEFORE SubscriptionConfirmation
  // auto-confirm so attacker topics can't onboard via this endpoint.
  const verify = await verifySnsSignature(body, undefined, {
    allowedTopicArns: allowedBounceTopicArns(),
  })
  if (verify.kind !== 'verified') {
    // Include topicArn so ops can distinguish misconfiguration
    // (legitimate-but-not-allowlisted topic) from attempted attack
    // (attacker topic) without needing to correlate with separate
    // log lines. Closes the observability gap surfaced in the
    // Phase 4 security review.
    logger.warn(
      {
        webhook: 'ses-bounce',
        verify: verify.kind,
        topicArn: body.TopicArn,
        messageId: body.MessageId,
      },
      'webhook.sig.failed',
    )
    return c.json({ ok: true, ignored: 'signature_failed' })
  }

  // SubscriptionConfirmation — confirm. Defence-in-depth: validate
  // SubscribeURL is an sns.<region>.amazonaws.com URL before fetching.
  // The TopicArn check above is the load-bearing gate; this is the
  // belt-and-suspenders against SSRF.
  if (body.Type === 'SubscriptionConfirmation' && body.SubscribeURL) {
    if (!isSafeSnsActionUrl(body.SubscribeURL)) {
      logger.warn(
        { webhook: 'ses-bounce', subscribeUrl: body.SubscribeURL },
        'webhook.sns.subscribe_url_unsafe',
      )
      return c.json({ ok: true, ignored: 'subscribe_url_unsafe' })
    }
    logger.info(
      { webhook: 'ses-bounce', topicArn: body.TopicArn },
      'webhook.sns.subscription_confirm',
    )
    try {
      await fetchUrl(body.SubscribeURL)
    } catch (err) {
      logger.warn({ err, webhook: 'ses-bounce' }, 'webhook.sns.subscribe_url_fetch_failed')
    }
    return c.json({ ok: true, action: 'subscription_confirmed' })
  }

  if (body.Type === 'UnsubscribeConfirmation' && body.UnsubscribeURL) {
    if (!isSafeSnsActionUrl(body.UnsubscribeURL)) {
      logger.warn(
        { webhook: 'ses-bounce', unsubscribeUrl: body.UnsubscribeURL },
        'webhook.sns.unsubscribe_url_unsafe',
      )
      return c.json({ ok: true, ignored: 'unsubscribe_url_unsafe' })
    }
    logger.info(
      { webhook: 'ses-bounce', topicArn: body.TopicArn },
      'webhook.sns.unsubscribe_confirm',
    )
    try {
      await fetchUrl(body.UnsubscribeURL)
    } catch (err) {
      logger.warn({ err, webhook: 'ses-bounce' }, 'webhook.sns.unsubscribe_url_fetch_failed')
    }
    return c.json({ ok: true, action: 'unsubscribe_confirmed' })
  }

  // Notification — parse SES bounce payload from the Message field
  // (which is a JSON-encoded string inside the SNS envelope).
  if (body.Type !== 'Notification') {
    return c.json({ ok: true, ignored: `unknown_type:${body.Type}` })
  }

  let sesPayload: SesBounceMessage
  try {
    sesPayload = JSON.parse(body.Message) as SesBounceMessage
  } catch {
    logger.warn(
      { webhook: 'ses-bounce', messageId: body.MessageId },
      'webhook.ses.message_unparseable',
    )
    return c.json({ ok: true, ignored: 'message_unparseable' })
  }
  if (sesPayload.notificationType !== 'Bounce') {
    return c.json({ ok: true, ignored: `not_a_bounce:${sesPayload.notificationType}` })
  }

  const reason = bounceTypeToReason(sesPayload.bounce.bounceType)
  const suppressedUntil =
    reason === 'soft_bounce_temporary'
      ? new Date(Date.now() + SOFT_BOUNCE_SUPPRESS_HOURS * 60 * 60 * 1000)
      : null

  let suppressedCount = 0
  for (const recipient of sesPayload.bounce.bouncedRecipients) {
    if (!recipient.emailAddress) continue
    try {
      await upsertSuppression({
        email: recipient.emailAddress,
        reason,
        sourceMessageId: body.MessageId,
        suppressedUntil,
        notes: recipient.diagnosticCode ?? null,
      })
      suppressedCount++
      logger.info(
        {
          webhook: 'ses-bounce',
          messageId: body.MessageId,
          emailHash: hashEmail(recipient.emailAddress),
          reason,
        },
        'webhook.ses.bounce.suppressed',
      )
    } catch (err) {
      logger.error(
        { err, webhook: 'ses-bounce', messageId: body.MessageId },
        'webhook.ses.bounce.suppress_failed',
      )
    }
  }

  return c.json({ ok: true, action: 'suppressed', count: suppressedCount })
})

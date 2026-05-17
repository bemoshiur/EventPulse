/**
 * AWS SES v2 client per CLAUDE.md §16.1.
 *
 * Sender domain identity is created out-of-band (Day 9-10 / SES setup);
 * this module just wraps the AWS SDK send call. Templates live next door
 * in `templates/*.ts` as TS-string functions (no SES templates resource
 * — easier to version-control + diff). Bouncing / complaint webhooks
 * land in `webhooks/ses.ts` later.
 *
 * Env:
 *   AWS_REGION              defaults to ap-southeast-1
 *   AWS_SES_FROM            "Event Pulse <hello@eventpulse.com.bd>"
 *   AWS_SES_RETURN_PATH     optional; for bounces (defaults to FROM)
 *   AWS_SES_CONFIGURATION_SET optional; engagement tracking
 *
 * When `MAIL_DRY_RUN === '1'` the client logs the payload and returns
 * a synthetic message-id without hitting AWS — useful for local dev +
 * CI integration tests that don't have SES credentials.
 */

import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'

import { logger } from '../../lib/logger.js'

let _client: SESv2Client | undefined

function client(): SESv2Client {
  if (!_client) {
    _client = new SESv2Client({
      region: process.env['AWS_REGION'] ?? 'ap-southeast-1',
    })
  }
  return _client
}

export interface SendEmailInput {
  to: string | string[]
  subject: string
  text: string
  html?: string
  replyTo?: string[]
  tags?: Record<string, string>
}

export interface SendEmailResult {
  messageId: string
  dryRun: boolean
}

function from(): string {
  return process.env['AWS_SES_FROM'] ?? 'Event Pulse <hello@eventpulse.com.bd>'
}

function returnPath(): string {
  return process.env['AWS_SES_RETURN_PATH'] ?? from().replace(/^.*<(.+)>.*$/, '$1')
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const toAddresses = Array.isArray(input.to) ? input.to : [input.to]

  if (process.env['MAIL_DRY_RUN'] === '1') {
    logger.info(
      {
        to: toAddresses,
        subject: input.subject,
        tags: input.tags ?? {},
        dryRun: true,
      },
      'ses.dry_run',
    )
    return { messageId: `dryrun-${Date.now()}`, dryRun: true }
  }

  const cmd = new SendEmailCommand({
    FromEmailAddress: from(),
    Destination: { ToAddresses: toAddresses },
    ReplyToAddresses: input.replyTo,
    FeedbackForwardingEmailAddress: returnPath(),
    Content: {
      Simple: {
        Subject: { Data: input.subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: input.text, Charset: 'UTF-8' },
          ...(input.html ? { Html: { Data: input.html, Charset: 'UTF-8' } } : {}),
        },
      },
    },
    ConfigurationSetName: process.env['AWS_SES_CONFIGURATION_SET'],
    EmailTags: input.tags
      ? Object.entries(input.tags).map(([Name, Value]) => ({ Name, Value }))
      : undefined,
  })

  const result = await client().send(cmd)
  return { messageId: result.MessageId ?? 'unknown', dryRun: false }
}

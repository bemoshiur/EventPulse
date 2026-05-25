/**
 * SES raw-MIME send — attachments support.
 *
 * The Day 21 `client.ts sendEmail()` uses `SendEmailCommand` with
 * `Content.Simple` which does NOT support attachments. The Day 28
 * delivery worker needs to attach a PDF per attendee. AWS SES v2's
 * attachment path is `Content.Raw` — we hand SES a fully-formed
 * MIME message and it relays it as-is.
 *
 * Why a separate file (not extending client.ts):
 *   - Different shape: raw MIME has different semantics + error
 *     surfaces than the simple-content path.
 *   - Different test coverage: MIME building + multipart encoding
 *     deserves focused tests.
 *   - Keep client.ts narrow: it's the simple-send hot path for the
 *     existing notification surface (KYC, magic link, etc.).
 *
 * MIME structure for one email with one PDF attachment:
 *
 *   multipart/mixed
 *   ├── multipart/alternative
 *   │   ├── text/plain
 *   │   └── text/html
 *   └── application/pdf (one part per attachment)
 *
 * **MAIL_DRY_RUN behaviour:** when MAIL_DRY_RUN=1, the function
 * logs the recipients + subject + attachment metadata (NAME + size,
 * NOT contents — PDFs are buyer PII / event-attendance data) and
 * returns a synthetic message id. Same dry-run contract as client.ts.
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

export interface MimeAttachment {
  filename: string
  /** MIME type, e.g. `application/pdf`. */
  contentType: string
  /** Binary content. */
  content: Buffer
}

export interface SendEmailRawInput {
  to: string | string[]
  subject: string
  text: string
  html?: string
  attachments?: MimeAttachment[]
  replyTo?: string[]
  tags?: Record<string, string>
}

export interface SendEmailRawResult {
  messageId: string
  dryRun: boolean
  bytes: number
}

function from(): string {
  return process.env['AWS_SES_FROM'] ?? 'Event Pulse <hello@eventpulse.com.bd>'
}

function returnPath(): string {
  return process.env['AWS_SES_RETURN_PATH'] ?? from().replace(/^.*<(.+)>.*$/, '$1')
}

/**
 * Pure helper — build a MIME-formatted email body. Exposed for tests
 * so we can pin the MIME structure without running through SES.
 */
export function buildMimeMessage(input: SendEmailRawInput): Buffer {
  const toAddresses = Array.isArray(input.to) ? input.to : [input.to]
  const boundary = `EP-mixed-${Math.random().toString(36).slice(2)}-${Date.now()}`
  const altBoundary = `EP-alt-${Math.random().toString(36).slice(2)}-${Date.now()}`

  const lines: string[] = []
  lines.push(`From: ${from()}`)
  lines.push(`To: ${toAddresses.join(', ')}`)
  if (input.replyTo && input.replyTo.length > 0) {
    lines.push(`Reply-To: ${input.replyTo.join(', ')}`)
  }
  lines.push(`Subject: ${encodeMimeHeader(input.subject)}`)
  lines.push('MIME-Version: 1.0')
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
  lines.push('')

  // ─── multipart/alternative (text + html) ────────────────────────
  lines.push(`--${boundary}`)
  lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`)
  lines.push('')

  lines.push(`--${altBoundary}`)
  lines.push('Content-Type: text/plain; charset="UTF-8"')
  lines.push('Content-Transfer-Encoding: base64')
  lines.push('')
  lines.push(splitBase64(Buffer.from(input.text, 'utf-8').toString('base64')))

  if (input.html) {
    lines.push(`--${altBoundary}`)
    lines.push('Content-Type: text/html; charset="UTF-8"')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(splitBase64(Buffer.from(input.html, 'utf-8').toString('base64')))
  }

  lines.push(`--${altBoundary}--`)

  // ─── attachments ────────────────────────────────────────────────
  for (const att of input.attachments ?? []) {
    lines.push(`--${boundary}`)
    lines.push(`Content-Type: ${att.contentType}; name="${att.filename}"`)
    lines.push(`Content-Disposition: attachment; filename="${att.filename}"`)
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(splitBase64(att.content.toString('base64')))
  }

  lines.push(`--${boundary}--`)

  // Use CRLF per RFC 5322 (SES expects this on raw input).
  return Buffer.from(lines.join('\r\n'), 'utf-8')
}

/**
 * Split base64 into 76-char lines per RFC 2045.
 */
function splitBase64(b64: string): string {
  return b64.match(/.{1,76}/g)?.join('\r\n') ?? b64
}

/**
 * Encode non-ASCII subject lines via RFC 2047 B-encoding. Bangla
 * subject lines would otherwise break in mail clients that don't
 * tolerate raw UTF-8 in headers.
 */
function encodeMimeHeader(value: string): string {
  // ASCII-safe → pass through.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(value)) return value
  const b64 = Buffer.from(value, 'utf-8').toString('base64')
  return `=?UTF-8?B?${b64}?=`
}

/**
 * Send a raw-MIME email via SES, with optional attachments. Honours
 * MAIL_DRY_RUN=1 (no AWS call; returns synthetic message id).
 */
export async function sendEmailRaw(input: SendEmailRawInput): Promise<SendEmailRawResult> {
  const toAddresses = Array.isArray(input.to) ? input.to : [input.to]

  const mime = buildMimeMessage(input)

  if (process.env['MAIL_DRY_RUN'] === '1') {
    logger.info(
      {
        to: toAddresses,
        subject: input.subject,
        attachments: (input.attachments ?? []).map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          bytes: a.content.length,
        })),
        mimeBytes: mime.length,
        tags: input.tags ?? {},
        dryRun: true,
      },
      'ses.dry_run.raw',
    )
    return { messageId: `dryrun-raw-${Date.now()}`, dryRun: true, bytes: mime.length }
  }

  const cmd = new SendEmailCommand({
    FromEmailAddress: from(),
    Destination: { ToAddresses: toAddresses },
    ReplyToAddresses: input.replyTo,
    FeedbackForwardingEmailAddress: returnPath(),
    Content: {
      Raw: { Data: mime },
    },
    ConfigurationSetName: process.env['AWS_SES_CONFIGURATION_SET'],
    EmailTags: input.tags
      ? Object.entries(input.tags).map(([Name, Value]) => ({ Name, Value }))
      : undefined,
  })

  const result = await client().send(cmd)
  return { messageId: result.MessageId ?? 'unknown', dryRun: false, bytes: mime.length }
}

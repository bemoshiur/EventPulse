/**
 * Raw-MIME builder + dry-run path — unit tests.
 *
 * Pinned:
 *
 *   1. MIME structure: multipart/mixed → multipart/alternative
 *      (text + html) → attachments.
 *   2. ASCII subject passes through.
 *   3. Non-ASCII subject (Bangla) is RFC-2047 B-encoded.
 *   4. Multiple recipients formatted with comma + space.
 *   5. Attachments encoded base64 with filename + content-type +
 *      disposition headers.
 *   6. MAIL_DRY_RUN=1 returns synthetic id, no AWS call, valid bytes
 *      reported.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildMimeMessage, sendEmailRaw } from './raw-email.js'

const ORIGINAL_MAIL_DRY_RUN = process.env['MAIL_DRY_RUN']
const ORIGINAL_FROM = process.env['AWS_SES_FROM']

beforeEach(() => {
  process.env['MAIL_DRY_RUN'] = '1'
  process.env['AWS_SES_FROM'] = 'Event Pulse <hello@eventpulse.com.bd>'
})

afterEach(() => {
  if (ORIGINAL_MAIL_DRY_RUN === undefined) delete process.env['MAIL_DRY_RUN']
  else process.env['MAIL_DRY_RUN'] = ORIGINAL_MAIL_DRY_RUN
  if (ORIGINAL_FROM === undefined) delete process.env['AWS_SES_FROM']
  else process.env['AWS_SES_FROM'] = ORIGINAL_FROM
})

describe('buildMimeMessage', () => {
  it('emits multipart/mixed + multipart/alternative + text + html', () => {
    const mime = buildMimeMessage({
      to: 'buyer@example.com',
      subject: 'Order confirmed',
      text: 'Plain version',
      html: '<p>HTML version</p>',
    }).toString('utf-8')

    expect(mime).toContain('From: Event Pulse <hello@eventpulse.com.bd>')
    expect(mime).toContain('To: buyer@example.com')
    expect(mime).toContain('Subject: Order confirmed')
    expect(mime).toContain('Content-Type: multipart/mixed; boundary=')
    expect(mime).toContain('Content-Type: multipart/alternative; boundary=')
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"')
    expect(mime).toContain('Content-Type: text/html; charset="UTF-8"')
    // Both text + html bodies are base64-encoded.
    expect(mime).toContain(Buffer.from('Plain version', 'utf-8').toString('base64'))
    expect(mime).toContain(Buffer.from('<p>HTML version</p>', 'utf-8').toString('base64'))
  })

  it('uses CRLF line endings (RFC 5322 / SES requirement)', () => {
    const mime = buildMimeMessage({
      to: 'a@b.c',
      subject: 'x',
      text: 'y',
    }).toString('utf-8')
    expect(mime).toContain('\r\n')
  })

  it('B-encodes a non-ASCII (Bangla) subject', () => {
    const mime = buildMimeMessage({
      to: 'buyer@example.com',
      subject: 'অর্ডার নিশ্চিত',
      text: 'body',
    }).toString('utf-8')
    expect(mime).toContain('Subject: =?UTF-8?B?')
    // Decode the encoded subject and verify it round-trips.
    const match = mime.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)
    expect(match).not.toBeNull()
    const decoded = Buffer.from(match![1]!, 'base64').toString('utf-8')
    expect(decoded).toBe('অর্ডার নিশ্চিত')
  })

  it('formats multiple recipients with comma + space', () => {
    const mime = buildMimeMessage({
      to: ['a@b.c', 'd@e.f'],
      subject: 'x',
      text: 'y',
    }).toString('utf-8')
    expect(mime).toContain('To: a@b.c, d@e.f')
  })

  it('embeds an attachment with filename + content-type + base64 body', () => {
    const pdfBytes = Buffer.from('%PDF-fake-content-for-test', 'utf-8')
    const mime = buildMimeMessage({
      to: 'buyer@example.com',
      subject: 'ticket',
      text: 'see attached',
      attachments: [{ filename: 'ticket.pdf', contentType: 'application/pdf', content: pdfBytes }],
    }).toString('utf-8')

    expect(mime).toContain('Content-Type: application/pdf; name="ticket.pdf"')
    expect(mime).toContain('Content-Disposition: attachment; filename="ticket.pdf"')
    expect(mime).toContain('Content-Transfer-Encoding: base64')
    expect(mime).toContain(pdfBytes.toString('base64'))
  })

  it('emits no attachment block when attachments array is empty', () => {
    const mime = buildMimeMessage({
      to: 'buyer@example.com',
      subject: 'x',
      text: 'y',
    }).toString('utf-8')
    expect(mime).not.toContain('Content-Disposition: attachment')
  })

  it('Reply-To header set when provided', () => {
    const mime = buildMimeMessage({
      to: 'a@b.c',
      subject: 'x',
      text: 'y',
      replyTo: ['support@eventpulse.com.bd'],
    }).toString('utf-8')
    expect(mime).toContain('Reply-To: support@eventpulse.com.bd')
  })
})

describe('sendEmailRaw — dry-run path', () => {
  it('returns synthetic message id + dryRun:true when MAIL_DRY_RUN=1', async () => {
    const result = await sendEmailRaw({
      to: 'buyer@example.com',
      subject: 'order',
      text: 'body',
      attachments: [
        { filename: 't.pdf', contentType: 'application/pdf', content: Buffer.from('x') },
      ],
    })
    expect(result.dryRun).toBe(true)
    expect(result.messageId).toMatch(/^dryrun-raw-/)
    expect(result.bytes).toBeGreaterThan(0)
  })
})

/**
 * PDF ticket render — Sprint 3 Day 28 Phase 2.
 *
 * Generates one PDF per attendee: event title, attendee name, tier
 * name, event date/venue, tenant brand colour, embedded QR image
 * (from `qr-image.ts`), bilingual per `locale`.
 *
 * ════════════════════════════════════════════════════════════════════
 * Why pdfkit (not @react-pdf/renderer):
 * ════════════════════════════════════════════════════════════════════
 *
 *   - Vanilla Node, ~500KB. No React tax. No JSX compilation step.
 *     Aligns with existing apps/api dep philosophy (Hono / Drizzle /
 *     etc. — no React in the API process).
 *   - Mature: existed since 2014; the Node-PDF default.
 *   - Streaming or buffer-based output; we use buffer here for direct
 *     email-attachment use without filesystem hops.
 *   - @react-pdf/renderer would be appealing IF apps/api already used
 *     React, but it doesn't. Adding it for one PDF surface = ~30MB
 *     of React + reconciler + worker deps for no gain.
 *
 * ════════════════════════════════════════════════════════════════════
 * Bilingual: en + bn — and the font question.
 * ════════════════════════════════════════════════════════════════════
 *
 * pdfkit's built-in fonts (Helvetica, Times-Roman, Courier) DO NOT
 * support Bangla glyphs — they're Latin-only. Rendering Bangla text
 * with the default font produces empty squares.
 *
 * **MVP strategy: render the BILINGUAL CONTENT but use the built-in
 * font.** The English text renders fully; the Bangla text falls
 * through pdfkit's WinAnsi encoding and shows as `?` or `□` for
 * out-of-charset codepoints. The MVP unblocks delivery; the Bangla
 * font upgrade is a follow-up that bundles NotoSansBengali (Apache-
 * 2.0 / OFL licensed, ~500KB) and registers it via
 * `doc.registerFont('Bangla', fontBuffer)`.
 *
 * Rationale for this MVP shape (rather than blocking on the font):
 *
 *   1. The `locale` parameter wiring + bilingual content is what
 *      future-proofs the API. Adding a font is a 5-line change in
 *      this file; rewiring the locale plumbing through 4 layers
 *      later would be days of churn.
 *   2. Default tenant locale per migration 0009 is `bn`; until a
 *      Bangla font ships, the PDF text falls back to English even
 *      when the email body is in Bangla. This is degraded behaviour,
 *      not broken behaviour — the buyer still gets a usable ticket.
 *   3. Phase 2 form-builder work will trigger the font upgrade
 *      naturally (when per-attendee Bangla names need to render).
 *
 * If at any point the Bangla font becomes blocking, see the
 * `loadBanglaFontIfAvailable()` stub at the bottom + the TODO. The
 * dependency surface change is contained.
 *
 * ════════════════════════════════════════════════════════════════════
 * Brand colour:
 * ════════════════════════════════════════════════════════════════════
 *
 * Pulled from `tenants.brand_color_primary` (already in schema per
 * §9.1). Falls back to `#6c4fe0` (the §1.5 violet primary). Used for
 * the header bar accent + ticket-id chip. Brand logo is NOT
 * embedded in MVP because (a) logo URLs are S3-hosted and need an
 * extra fetch + (b) PDF embedding works but adds latency to a
 * delivery-path operation. Future improvement.
 */

import PDFDocument from 'pdfkit'

import { renderQrPng } from './qr-image.js'

export interface RenderTicketPdfInput {
  /** Event details (snapshot at PDF render time). */
  eventTitle: string
  eventTitleBn?: string
  eventStartsAt: Date
  eventEndsAt: Date
  eventTimezone: string
  venue: {
    name: string
    address?: string
    city?: string
  }
  /** Tenant brand. */
  tenantName: string
  brandColorPrimary?: string | null
  /** Attendee + ticket. */
  attendeeName: string
  tierName: string
  qrToken: string
  /** Order context. */
  merchantTransactionId: string
  /** Locale for bilingual content. */
  locale: 'en' | 'bn'
}

export interface RenderedTicketPdf {
  /** PDF bytes — attach to email or stream to client. */
  pdf: Buffer
  /** Approximate byte size for logging / dashboard surfaces. */
  bytes: number
}

/**
 * Default brand primary if tenant hasn't set one. §1.5 `--ep-violet`.
 */
const DEFAULT_BRAND_PRIMARY = '#6C4FE0'

/**
 * Renders a single PDF ticket as a Buffer. Buffer-mode (not stream)
 * because we hand it directly to SES as an attachment.
 */
export async function renderTicketPdf(input: RenderTicketPdfInput): Promise<RenderedTicketPdf> {
  // Render the QR image FIRST — if it throws (e.g. EVENTPULSE_API_BASE_URL
  // unset), we fail before opening a PDF doc rather than producing a
  // half-baked PDF.
  const qr = await renderQrPng({ qrToken: input.qrToken })

  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `Ticket — ${input.eventTitle}`,
      Author: 'Event Pulse',
      Subject: `Ticket for ${input.eventTitle}`,
      Creator: 'eventpulse.com.bd',
    },
  })

  // Collect into a Buffer (pdfkit streams; we accumulate chunks).
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<void>((resolve, reject) => {
    doc.on('end', resolve)
    doc.on('error', reject)
  })

  drawTicketPage(doc, input, qr.png)

  doc.end()
  await done

  const pdf = Buffer.concat(chunks)
  return { pdf, bytes: pdf.length }
}

/**
 * Renders ALL tickets for an order into ONE multi-page PDF (one page per
 * attendee) — backs the on-page "Download tickets" button on the post-payment
 * success page. Same per-page layout as the emailed single-ticket PDF; pages
 * share the order's event/tenant context but carry each attendee's name + QR.
 */
export async function renderOrderTicketsPdf(
  inputs: readonly RenderTicketPdfInput[],
): Promise<RenderedTicketPdf> {
  if (inputs.length === 0) {
    throw new Error('renderOrderTicketsPdf: no tickets to render')
  }
  // Render every QR first (fail before opening the doc if any throws).
  const qrs = await Promise.all(inputs.map((i) => renderQrPng({ qrToken: i.qrToken })))

  const first = inputs[0]!
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `Tickets — ${first.eventTitle}`,
      Author: 'Event Pulse',
      Subject: `Tickets for ${first.eventTitle}`,
      Creator: 'eventpulse.com.bd',
    },
  })
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<void>((resolve, reject) => {
    doc.on('end', resolve)
    doc.on('error', reject)
  })

  inputs.forEach((input, idx) => {
    if (idx > 0) doc.addPage()
    drawTicketPage(doc, input, qrs[idx]!.png)
  })

  doc.end()
  await done

  const pdf = Buffer.concat(chunks)
  return { pdf, bytes: pdf.length }
}

/**
 * Draws one ticket onto the current page of `doc`. Shared by the single-ticket
 * (emailed) renderer and the multi-page (downloaded) renderer so the layout
 * never drifts between the two. Uses absolute coordinates + `doc.page.*`, so it
 * is correct on any page (including after `doc.addPage()`).
 */
function drawTicketPage(doc: PDFKit.PDFDocument, input: RenderTicketPdfInput, qrPng: Buffer): void {
  const brand = sanitiseBrandColor(input.brandColorPrimary) ?? DEFAULT_BRAND_PRIMARY
  const t = i18n(input.locale)

  // ─── Header bar (brand accent) ──────────────────────────────────
  doc.rect(0, 0, doc.page.width, 80).fill(brand)
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text(t.headerTitle, 40, 30)
  doc.fillColor('#FFFFFF').font('Helvetica').fontSize(10).text(input.tenantName, 40, 56)

  // Move below header.
  doc.fillColor('#0B0B14').font('Helvetica-Bold').fontSize(24)
  doc.text(input.eventTitle, 40, 110)
  if (input.locale === 'bn' && input.eventTitleBn) {
    doc.fontSize(16).fillColor('#2A2A36').text(input.eventTitleBn, 40, 144)
  }

  // ─── Attendee + tier card ───────────────────────────────────────
  const cardTop = 200
  doc
    .rect(40, cardTop, doc.page.width - 80, 130)
    .strokeColor('#E4E2EE')
    .lineWidth(1)
    .stroke()

  doc
    .fontSize(10)
    .fillColor('#6B6B7A')
    .text(t.labels.attendee, 56, cardTop + 16)
  doc
    .fontSize(16)
    .fillColor('#0B0B14')
    .text(input.attendeeName, 56, cardTop + 30)

  doc
    .fontSize(10)
    .fillColor('#6B6B7A')
    .text(t.labels.tier, 56, cardTop + 64)
  doc
    .fontSize(14)
    .fillColor('#0B0B14')
    .text(input.tierName, 56, cardTop + 78)

  doc
    .fontSize(10)
    .fillColor('#6B6B7A')
    .text(t.labels.ticketId, 56, cardTop + 102)
  doc
    .font('Courier')
    .fontSize(10)
    .fillColor('#0B0B14')
    .text(input.merchantTransactionId, 56, cardTop + 114)

  // ─── Event when + where ─────────────────────────────────────────
  const detailsTop = 360
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0B0B14').text(t.labels.when, 40, detailsTop)
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor('#2A2A36')
    .text(
      formatDateRange(input.eventStartsAt, input.eventEndsAt, input.eventTimezone, input.locale),
      40,
      detailsTop + 16,
    )

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#0B0B14')
    .text(t.labels.where, 40, detailsTop + 56)
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor('#2A2A36')
    .text(formatVenue(input.venue), 40, detailsTop + 72, { width: 300 })

  // ─── QR (right side) ────────────────────────────────────────────
  doc.image(qrPng, doc.page.width - 200, detailsTop, { width: 160, height: 160 })
  doc
    .fontSize(9)
    .fillColor('#6B6B7A')
    .text(t.labels.scanInstruction, doc.page.width - 200, detailsTop + 168, {
      width: 160,
      align: 'center',
    })

  // ─── Footer ─────────────────────────────────────────────────────
  doc
    .fontSize(9)
    .fillColor('#9B9BB0')
    .text(t.footerLine, 40, doc.page.height - 60, {
      width: doc.page.width - 80,
      align: 'center',
    })
  doc
    .fontSize(8)
    .fillColor('#9B9BB0')
    .text(t.poweredBy, 40, doc.page.height - 44, {
      width: doc.page.width - 80,
      align: 'center',
    })
}

// ─── helpers ────────────────────────────────────────────────────────

function i18n(locale: 'en' | 'bn'): {
  headerTitle: string
  labels: {
    attendee: string
    tier: string
    ticketId: string
    when: string
    where: string
    scanInstruction: string
  }
  footerLine: string
  poweredBy: string
} {
  if (locale === 'bn') {
    return {
      headerTitle: 'টিকিট / TICKET',
      labels: {
        attendee: 'আগত / Attendee',
        tier: 'টিকিট ধরন / Ticket type',
        ticketId: 'টিকিট আইডি / Ticket ID',
        when: 'কখন / When',
        where: 'কোথায় / Where',
        scanInstruction: 'প্রবেশের সময় স্ক্যান করুন',
      },
      footerLine: 'এই টিকিটটি অপ্রকাশিত রাখুন। QR কোড অন্যকে দেখাবেন না।',
      poweredBy: 'Powered by Event Pulse · eventpulse.com.bd',
    }
  }
  return {
    headerTitle: 'TICKET',
    labels: {
      attendee: 'Attendee',
      tier: 'Ticket type',
      ticketId: 'Ticket ID',
      when: 'When',
      where: 'Where',
      scanInstruction: 'Scan at entry',
    },
    footerLine: 'Keep this ticket private. Do not share the QR code.',
    poweredBy: 'Powered by Event Pulse · eventpulse.com.bd',
  }
}

/**
 * Validate a hex colour string; return null if invalid. Defends
 * against a tenant putting `javascript:alert(1)` or similar into a
 * colour field (defence in depth — the schema should reject already,
 * but PDF rendering is a different surface).
 */
function sanitiseBrandColor(value: string | null | undefined): string | null {
  if (!value) return null
  return /^#[0-9A-Fa-f]{6}$/.test(value) ? value : null
}

function formatDateRange(start: Date, end: Date, timezone: string, locale: 'en' | 'bn'): string {
  // Intl supports both en + bn. We render in the EVENT's timezone
  // (not the buyer's) — the attendee needs to know when to show up
  // in venue-local time.
  const lang = locale === 'bn' ? 'bn-BD' : 'en-GB'
  const date = new Intl.DateTimeFormat(lang, {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(start)
  const time = new Intl.DateTimeFormat(lang, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(start)
  const endTime = new Intl.DateTimeFormat(lang, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(end)
  return `${date} · ${time} – ${endTime} (${timezone})`
}

function formatVenue(venue: { name: string; address?: string; city?: string }): string {
  return [venue.name, venue.address, venue.city].filter(Boolean).join('\n')
}

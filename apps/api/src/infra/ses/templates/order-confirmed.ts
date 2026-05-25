/**
 * Transactional template — order confirmed.
 *
 * Per §16.3 `order.confirmed`. Sent to the BUYER on the
 * `awaiting_payment → paid` transition (Day 27 settle service's
 * settled-paid branch). Bilingual per Decision O.2 / §1.3 R12.
 *
 * **No PDF attachment.** This is the order-summary email — money +
 * what they bought + when. The per-attendee ticket PDF rides on
 * `attendee_ticket` emails. Two emails per order is the right
 * decoupling: the buyer gets the receipt; the attendees get the
 * tickets. If buyer == attendee (single-attendee order), they get
 * BOTH emails which is fine — receipt + ticket are distinct artifacts.
 */

import type { LocaleCode } from '../../../services/notifications/locale.js'

export interface OrderConfirmedVars {
  buyerName: string
  eventTitle: string
  eventStartsAt: Date
  eventTimezone: string
  venue: string
  ticketCount: number
  /** Total paid in paisa. Rendered to BDT decimal at display. */
  totalPaisa: bigint
  /** Order summary URL — the buyer's `my.eventpulse` order page. */
  orderUrl: string
  locale: LocaleCode
}

export interface RenderedEmail {
  templateId: string
  subject: string
  text: string
  html: string
}

function formatBdt(paisa: bigint): string {
  // 100 paisa = 1 BDT. Display with 2 decimal places.
  const bdt = Number(paisa) / 100
  return bdt.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateTime(date: Date, timezone: string, locale: LocaleCode): string {
  const lang = locale === 'bn' ? 'bn-BD' : 'en-GB'
  return new Intl.DateTimeFormat(lang, {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function renderOrderConfirmed(vars: OrderConfirmedVars): RenderedEmail {
  const totalBdt = formatBdt(vars.totalPaisa)
  const when = formatDateTime(vars.eventStartsAt, vars.eventTimezone, vars.locale)
  const ticketsWord =
    vars.ticketCount === 1
      ? vars.locale === 'bn'
        ? 'টিকিট'
        : 'ticket'
      : vars.locale === 'bn'
        ? 'টিকিট'
        : 'tickets'

  const subject =
    vars.locale === 'bn'
      ? `অর্ডার নিশ্চিত — ${vars.eventTitle}`
      : `Order confirmed — ${vars.eventTitle}`

  const text =
    vars.locale === 'bn'
      ? [
          `নমস্কার ${vars.buyerName},`,
          ``,
          `আপনার অর্ডার নিশ্চিত হয়েছে।`,
          ``,
          `ইভেন্ট: ${vars.eventTitle}`,
          `কখন: ${when} (${vars.eventTimezone})`,
          `কোথায়: ${vars.venue}`,
          `টিকিট সংখ্যা: ${vars.ticketCount}`,
          `মোট পরিশোধিত: BDT ${totalBdt}`,
          ``,
          `প্রতিটি টিকিট আলাদা ইমেইলে QR কোডসহ পাঠানো হচ্ছে।`,
          `আপনার অর্ডার দেখুন: ${vars.orderUrl}`,
          ``,
          `প্রশ্ন থাকলে support@eventpulse.com.bd তে যোগাযোগ করুন।`,
          ``,
          `— Event Pulse`,
          `https://eventpulse.com.bd`,
        ].join('\n')
      : [
          `Hi ${vars.buyerName},`,
          ``,
          `Your order is confirmed.`,
          ``,
          `Event: ${vars.eventTitle}`,
          `When: ${when} (${vars.eventTimezone})`,
          `Where: ${vars.venue}`,
          `${ticketsWord.charAt(0).toUpperCase() + ticketsWord.slice(1)}: ${vars.ticketCount}`,
          `Total paid: BDT ${totalBdt}`,
          ``,
          `Each ticket is being sent in a separate email with its QR code.`,
          `View your order: ${vars.orderUrl}`,
          ``,
          `Questions? Reply to support@eventpulse.com.bd.`,
          ``,
          `— Event Pulse`,
          `https://eventpulse.com.bd`,
        ].join('\n')

  const heading = vars.locale === 'bn' ? 'অর্ডার নিশ্চিত' : 'Order confirmed'
  const greeting = vars.locale === 'bn' ? `নমস্কার ${vars.buyerName},` : `Hi ${vars.buyerName},`
  const intro = vars.locale === 'bn' ? `আপনার অর্ডার নিশ্চিত হয়েছে।` : `Your order is confirmed.`
  const ctaLabel = vars.locale === 'bn' ? 'অর্ডার দেখুন' : 'View order'
  const ticketsLine =
    vars.locale === 'bn'
      ? `প্রতিটি টিকিট আলাদা ইমেইলে QR কোডসহ পাঠানো হচ্ছে।`
      : `Each ticket is being sent in a separate email with its QR code.`
  const labels =
    vars.locale === 'bn'
      ? {
          event: 'ইভেন্ট',
          when: 'কখন',
          where: 'কোথায়',
          tickets: 'টিকিট সংখ্যা',
          total: 'মোট পরিশোধিত',
        }
      : { event: 'Event', when: 'When', where: 'Where', tickets: 'Tickets', total: 'Total paid' }

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f5fb;margin:0;padding:24px;color:#2a2a36">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(20,18,60,0.06)">
    <tr><td>
      <h1 style="font-size:20px;margin:0 0 16px;color:#0b0b14">${heading}</h1>
      <p style="margin:0 0 16px;line-height:1.6">${greeting}</p>
      <p style="margin:0 0 24px;line-height:1.6">${intro}</p>

      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px">
        <tr><td style="padding:8px 0;color:#6b6b7a;width:40%">${labels.event}</td><td style="padding:8px 0;color:#0b0b14"><strong>${escapeHtml(vars.eventTitle)}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#6b6b7a">${labels.when}</td><td style="padding:8px 0;color:#0b0b14">${escapeHtml(when)} (${escapeHtml(vars.eventTimezone)})</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b7a">${labels.where}</td><td style="padding:8px 0;color:#0b0b14">${escapeHtml(vars.venue)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b7a">${labels.tickets}</td><td style="padding:8px 0;color:#0b0b14">${vars.ticketCount}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b7a">${labels.total}</td><td style="padding:8px 0;color:#0b0b14"><strong>BDT ${totalBdt}</strong></td></tr>
      </table>

      <p style="margin:0 0 24px;line-height:1.6;color:#2a2a36">${ticketsLine}</p>
      <p style="margin:24px 0"><a href="${escapeHtmlAttr(vars.orderUrl)}" style="display:inline-block;background:#6c4fe0;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${ctaLabel}</a></p>

      <hr style="border:none;border-top:1px solid #e4e2ee;margin:24px 0">
      <p style="font-size:12px;color:#9b9bb0;margin:0">— Event Pulse · <a href="https://eventpulse.com.bd" style="color:#4a5bff">eventpulse.com.bd</a></p>
    </td></tr>
  </table>
</body></html>`

  return { templateId: 'order_confirmed', subject, text, html }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

function escapeHtmlAttr(s: string): string {
  return escapeHtml(s)
}

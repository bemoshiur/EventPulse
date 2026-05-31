/**
 * Transactional template — order disputed (wrong payment method).
 *
 * Per §16.3 + Day 39 Phase 2b. Sent to the BUYER on the
 * `awaiting_payment → disputed` transition triggered by the
 * Day-38-Phase-2a Verify-guard (PR #228) when EPS Verify returns
 * Success but `FinancialEntity` is anything other than `bKash`.
 * The order goes to `disputed` instead of `paid`; this email
 * explains why + sets refund-timeline expectation.
 *
 * Copy source: `docs/copy/bkash-only-launch.md` (PR #229) Phase 2b
 * section — the canonical EN + BN strings drafted at Day 38 Phase 3.
 * Subject + body text wired here verbatim from that copy plan.
 *
 * Bilingual per CLAUDE.md R12 + Decision O.2.
 *
 * **Refund timeline:** "within 5 business days" matches the Day 38
 * Phase 2 (d) Verify-guard operational expectation that ops issues
 * the manual refund via the EPS merchant dashboard (V5 has no public
 * refund API per §11.4) shortly after the dispute audit row is
 * surfaced via `GET /admin/orders/disputed`.
 */

import type { LocaleCode } from '../../../services/notifications/locale.js'

export interface OrderDisputedWrongMethodVars {
  buyerName: string
  eventTitle: string
  /** Amount paid in paisa (= the order's totalPaisa). Rendered to BDT decimal at display. */
  amountPaisa: bigint
  /** URL the buyer can return to in order to re-purchase via bKash (the event's public landing page). */
  eventUrl: string
  locale: LocaleCode
}

export interface RenderedEmail {
  templateId: string
  subject: string
  text: string
  html: string
}

function formatBdt(paisa: bigint): string {
  const bdt = Number(paisa) / 100
  return bdt.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Minimal HTML escape — defence-in-depth for interpolated values that
 * originate from buyer-form input (buyerName) or tenant-controlled
 * event metadata (eventTitle). Mirrors the kyc-rejected.ts pattern.
 * Plain-text body is unaffected (no HTML interpretation in plain text).
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * URL validator + escaper for the event-url CTA `href`. Rejects any
 * scheme other than http/https (blocks `javascript:` + `data:` etc).
 * On parse failure or disallowed scheme, returns `#` so the link is
 * inert rather than malicious. Result is also HTML-escaped (for
 * any oddly-encoded `&` or quote characters in the URL query string).
 */
function safeUrl(u: string): string {
  try {
    const p = new URL(u)
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return '#'
    return escapeHtml(p.toString())
  } catch {
    return '#'
  }
}

export function renderOrderDisputedWrongMethod(vars: OrderDisputedWrongMethodVars): RenderedEmail {
  const amount = formatBdt(vars.amountPaisa)
  // HTML-safe values for all interpolations into the html string below.
  // Plain-text body deliberately uses the unescaped raw values per the
  // kyc-rejected.ts precedent (text/plain has no HTML interpretation).
  const safeBuyerName = escapeHtml(vars.buyerName)
  const safeEventTitle = escapeHtml(vars.eventTitle)
  const safeEventUrl = safeUrl(vars.eventUrl)

  const subject =
    vars.locale === 'bn'
      ? 'আপনার সাম্প্রতিক পেমেন্ট সম্পর্কে — রিফান্ড আসছে'
      : 'About your recent payment — refund coming'

  const text =
    vars.locale === 'bn'
      ? [
          `নমস্কার ${vars.buyerName},`,
          ``,
          `আপনি সম্প্রতি Event Pulse-এর মাধ্যমে ${vars.eventTitle}-এর জন্য নিবন্ধন করার চেষ্টা করেছিলেন। ইভেন্টটি লঞ্চে শুধুমাত্র bKash পেমেন্ট গ্রহণ করে; আপনার পেমেন্ট অন্য পদ্ধতিতে করা হয়েছিল, তাই আমরা টিকিটটি দিতে পারিনি।`,
          ``,
          `আপনার সম্পূর্ণ পেমেন্ট (৳ ${amount}) ৫ কার্যদিবসের মধ্যে EPS মার্চেন্ট ড্যাশবোর্ডের মাধ্যমে ফেরত দেওয়া হবে।`,
          ``,
          `নিবন্ধন করতে, দয়া করে ইভেন্ট পেজে ফিরে যান এবং bKash ব্যবহার করুন: ${vars.eventUrl}`,
          ``,
          `অসুবিধার জন্য আমরা দুঃখিত। প্রশ্ন থাকলে support@eventpulse.com.bd তে যোগাযোগ করুন।`,
          ``,
          `— Event Pulse`,
          `https://eventpulse.com.bd`,
        ].join('\n')
      : [
          `Hi ${vars.buyerName},`,
          ``,
          `You recently attempted to register for ${vars.eventTitle} via Event Pulse. The event accepts bKash payments only at launch; your payment was made via another method, so we couldn't honor the ticket.`,
          ``,
          `Your full payment (৳ ${amount}) will be refunded via the EPS merchant dashboard within 5 business days.`,
          ``,
          `To register, please return to the event page and use bKash: ${vars.eventUrl}`,
          ``,
          `We're sorry for the inconvenience. Questions? Reply to support@eventpulse.com.bd.`,
          ``,
          `— Event Pulse`,
          `https://eventpulse.com.bd`,
        ].join('\n')

  const heading = vars.locale === 'bn' ? 'আপনার পেমেন্ট সম্পর্কে' : 'About your recent payment'
  const greeting = vars.locale === 'bn' ? `নমস্কার ${safeBuyerName},` : `Hi ${safeBuyerName},`
  const body1 =
    vars.locale === 'bn'
      ? `আপনি সম্প্রতি Event Pulse-এর মাধ্যমে <strong>${safeEventTitle}</strong>-এর জন্য নিবন্ধন করার চেষ্টা করেছিলেন। ইভেন্টটি লঞ্চে শুধুমাত্র <strong>bKash</strong> পেমেন্ট গ্রহণ করে; আপনার পেমেন্ট অন্য পদ্ধতিতে করা হয়েছিল, তাই আমরা টিকিটটি দিতে পারিনি।`
      : `You recently attempted to register for <strong>${safeEventTitle}</strong> via Event Pulse. The event accepts <strong>bKash</strong> payments only at launch; your payment was made via another method, so we couldn't honor the ticket.`
  const refundLabel = vars.locale === 'bn' ? 'রিফান্ড' : 'Refund'
  const refundLine =
    vars.locale === 'bn'
      ? `আপনার সম্পূর্ণ পেমেন্ট (৳ ${amount}) ৫ কার্যদিবসের মধ্যে EPS মার্চেন্ট ড্যাশবোর্ডের মাধ্যমে ফেরত দেওয়া হবে।`
      : `Your full payment (৳ ${amount}) will be refunded via the EPS merchant dashboard within 5 business days.`
  const ctaLabel = vars.locale === 'bn' ? 'ইভেন্ট পেজে ফিরে যান' : 'Return to event page'
  const ctaHint =
    vars.locale === 'bn'
      ? `নিবন্ধন করতে, দয়া করে ইভেন্ট পেজে ফিরে যান এবং bKash ব্যবহার করুন।`
      : `To register, please return to the event page and use bKash.`
  const apology =
    vars.locale === 'bn' ? `অসুবিধার জন্য আমরা দুঃখিত।` : `We're sorry for the inconvenience.`
  const footer =
    vars.locale === 'bn'
      ? `প্রশ্ন থাকলে <a href="mailto:support@eventpulse.com.bd" style="color:#4a5bff">support@eventpulse.com.bd</a> তে যোগাযোগ করুন।`
      : `Questions? Reply to <a href="mailto:support@eventpulse.com.bd" style="color:#4a5bff">support@eventpulse.com.bd</a>.`

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f5fb;margin:0;padding:24px;color:#2a2a36">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(20,18,60,0.06)">
    <tr><td>
      <h1 style="font-size:20px;margin:0 0 16px;color:#0b0b14">${heading}</h1>
      <p style="margin:0 0 16px;line-height:1.6">${greeting}</p>
      <p style="margin:0 0 16px;line-height:1.6">${body1}</p>
      <div style="background:#fff7ed;border-left:4px solid #ffb547;padding:12px 16px;border-radius:8px;margin:16px 0">
        <p style="margin:0;line-height:1.6"><strong>${refundLabel}:</strong> ${refundLine}</p>
      </div>
      <p style="margin:24px 0 8px;line-height:1.6">${ctaHint}</p>
      <p style="margin:0 0 24px"><a href="${safeEventUrl}" style="display:inline-block;background:#6c4fe0;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${ctaLabel}</a></p>
      <p style="font-size:13px;color:#6b6b7a;margin:0 0 16px;line-height:1.6">${apology}</p>
      <p style="font-size:13px;color:#6b6b7a;margin:0;line-height:1.6">${footer}</p>
      <hr style="border:none;border-top:1px solid #e4e2ee;margin:24px 0">
      <p style="font-size:12px;color:#9b9bb0;margin:0">— Event Pulse · <a href="https://eventpulse.com.bd" style="color:#4a5bff">eventpulse.com.bd</a></p>
    </td></tr>
  </table>
</body></html>`

  return { templateId: 'order_disputed_wrong_method', subject, text, html }
}

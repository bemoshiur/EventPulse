/**
 * Transactional template — "view your tickets" link for the buyer self-service
 * "My tickets" page. Sent when a guest buyer asks to retrieve their tickets by
 * email; clicking the link lists their orders + QR tickets. Bilingual.
 */

import type { RenderedEmail } from './magic-link.js'

export interface TicketAccessVars {
  url: string
  expiresAt: Date
  locale?: 'en' | 'bn'
}

function minutesUntil(expires: Date): number {
  return Math.max(1, Math.round((expires.getTime() - Date.now()) / 60_000))
}

export function renderTicketAccess(vars: TicketAccessVars): RenderedEmail {
  const mins = minutesUntil(vars.expiresAt)
  const locale = vars.locale ?? 'en'
  const subject = locale === 'bn' ? 'আপনার টিকিট দেখুন · Event Pulse' : 'Your tickets · Event Pulse'

  const en = [
    `Here's the link to view your Event Pulse tickets:`,
    ``,
    vars.url,
    ``,
    `This link expires in ${mins} minute${mins === 1 ? '' : 's'} and can only be used once.`,
    ``,
    `If you didn't request this, you can ignore this email.`,
    ``,
    `— Event Pulse`,
    `https://eventpulse.com.bd`,
  ].join('\n')

  const bn =
    locale === 'bn'
      ? [
          `আপনার Event Pulse টিকিট দেখার লিংক:`,
          ``,
          vars.url,
          ``,
          `এই লিংকটি ${mins} মিনিটে মেয়াদ শেষ হবে এবং একবারই ব্যবহার করা যাবে।`,
        ].join('\n')
      : ''

  const text = `${en}${bn ? `\n\n—\n${bn}` : ''}`

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#faf7f5;margin:0;padding:24px;color:#3a3a40">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(60,20,20,0.06)">
    <tr><td>
      <h1 style="font-size:20px;margin:0 0 16px;color:#1a1a1f">Your tickets</h1>
      <p style="margin:0 0 16px;line-height:1.6">Click below to view your Event Pulse tickets. This link expires in ${mins} minute${mins === 1 ? '' : 's'}.</p>
      <p style="margin:24px 0"><a href="${vars.url}" style="display:inline-block;background:#d32f2f;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">View my tickets</a></p>
      <p style="font-size:13px;color:#6b6b72;margin:24px 0 0;line-height:1.6">If the button doesn't work, paste this URL into your browser:<br><span style="word-break:break-all;color:#d32f2f">${vars.url}</span></p>
      <hr style="border:none;border-top:1px solid #ece8e6;margin:24px 0">
      <p style="font-size:12px;color:#9b9b9f;margin:0">If you didn't request this, you can safely ignore this email.<br>— Event Pulse · <a href="https://eventpulse.com.bd" style="color:#d32f2f">eventpulse.com.bd</a></p>
    </td></tr>
  </table>
</body></html>`

  return { templateId: 'buyer_ticket_access', subject, text, html }
}

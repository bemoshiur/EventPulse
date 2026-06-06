/**
 * Transactional template — confirm-your-email (password onboarding).
 *
 * Sent after a password signup. The user must click to verify their address
 * before they can log in. Bilingual (English first, Bangla underneath).
 * Single-source-of-truth subject + body so the SES bounce/complaint webhook can
 * correlate by template_id without parsing content.
 */

import type { RenderedEmail } from './magic-link.js'

export interface VerifyEmailVars {
  /** Full https URL the user clicks to confirm their address. */
  url: string
  expiresAt: Date
  locale?: 'en' | 'bn'
}

function minutesUntil(expires: Date): number {
  return Math.max(1, Math.round((expires.getTime() - Date.now()) / 60_000))
}

export function renderVerifyEmail(vars: VerifyEmailVars): RenderedEmail {
  const mins = minutesUntil(vars.expiresAt)
  const locale = vars.locale ?? 'en'
  const subject =
    locale === 'bn' ? 'আপনার ইমেইল নিশ্চিত করুন · Event Pulse' : 'Confirm your email · Event Pulse'

  const en = [
    `Welcome to Event Pulse!`,
    ``,
    `Confirm your email address to activate your account:`,
    ``,
    vars.url,
    ``,
    `This link expires in ${mins} minute${mins === 1 ? '' : 's'} and can only be used once.`,
    ``,
    `If you didn't create an account, you can ignore this email.`,
    ``,
    `— Event Pulse`,
    `https://eventpulse.com.bd`,
  ].join('\n')

  const bn =
    locale === 'bn'
      ? [
          `Event Pulse-এ স্বাগতম!`,
          ``,
          `আপনার অ্যাকাউন্ট সক্রিয় করতে নিচের লিংকে ক্লিক করে ইমেইল নিশ্চিত করুন:`,
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
      <h1 style="font-size:20px;margin:0 0 16px;color:#1a1a1f">Confirm your email</h1>
      <p style="margin:0 0 16px;line-height:1.6">Welcome to Event Pulse! Confirm your email address to activate your account. This link expires in ${mins} minute${mins === 1 ? '' : 's'}.</p>
      <p style="margin:24px 0"><a href="${vars.url}" style="display:inline-block;background:#d32f2f;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Confirm email</a></p>
      <p style="font-size:13px;color:#6b6b72;margin:24px 0 0;line-height:1.6">If the button doesn't work, paste this URL into your browser:<br><span style="word-break:break-all;color:#d32f2f">${vars.url}</span></p>
      <hr style="border:none;border-top:1px solid #ece8e6;margin:24px 0">
      <p style="font-size:12px;color:#9b9b9f;margin:0">If you didn't create an account, you can safely ignore this email.<br>— Event Pulse · <a href="https://eventpulse.com.bd" style="color:#d32f2f">eventpulse.com.bd</a></p>
    </td></tr>
  </table>
</body></html>`

  return { templateId: 'auth_verify_email', subject, text, html }
}

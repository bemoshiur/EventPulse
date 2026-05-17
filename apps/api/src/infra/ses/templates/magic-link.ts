/**
 * Transactional template — magic sign-in / sign-up link.
 *
 * Per CLAUDE.md §16.3 (`auth.magic_link`). Bilingual (English first,
 * Bangla underneath) for the bilingual-attendee surface, English-only
 * for tenant + super-admin destinations (caller passes `locale`).
 *
 * Single-source-of-truth subject + body so the SES Bounce/Complaint
 * webhook can correlate by template_id without parsing email content.
 */

export interface MagicLinkVars {
  /** Full URL (https) the user clicks to consume the token. */
  url: string
  /** Expires-at timestamp; rendered in 'in 15 minutes' style. */
  expiresAt: Date
  /** 'signin' or 'signup' — changes the verb in the subject line. */
  purpose: 'signin' | 'signup'
  /** 'en' (default) or 'bn'. */
  locale?: 'en' | 'bn'
}

export interface RenderedEmail {
  templateId: string
  subject: string
  text: string
  html: string
}

const verbEn = (p: MagicLinkVars['purpose']) => (p === 'signup' ? 'Finish signing up' : 'Sign in')
const verbBn = (p: MagicLinkVars['purpose']) =>
  p === 'signup' ? 'সাইন আপ সম্পন্ন করুন' : 'সাইন ইন করুন'

function minutesUntil(expires: Date): number {
  return Math.max(1, Math.round((expires.getTime() - Date.now()) / 60_000))
}

export function renderMagicLink(vars: MagicLinkVars): RenderedEmail {
  const mins = minutesUntil(vars.expiresAt)
  const locale = vars.locale ?? 'en'

  const subject =
    locale === 'bn'
      ? `${verbBn(vars.purpose)} Event Pulse-এ`
      : `${verbEn(vars.purpose)} to Event Pulse`

  const en = [
    `Hi,`,
    ``,
    `Click the link below to ${vars.purpose === 'signup' ? 'finish signing up' : 'sign in'} to Event Pulse.`,
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
          ``,
          `নমস্কার,`,
          ``,
          `নিচের লিংকে ক্লিক করে Event Pulse-এ ${vars.purpose === 'signup' ? 'সাইন আপ সম্পন্ন করুন' : 'সাইন ইন করুন'}।`,
          ``,
          vars.url,
          ``,
          `এই লিংকটি ${mins} মিনিটে মেয়াদ শেষ হবে এবং একবারই ব্যবহার করা যাবে।`,
        ].join('\n')
      : ''

  const text = `${en}${bn ? `\n\n—\n${bn}` : ''}`

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f5fb;margin:0;padding:24px;color:#2a2a36">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(20,18,60,0.06)">
    <tr><td>
      <h1 style="font-size:20px;margin:0 0 16px;color:#0b0b14">${subject}</h1>
      <p style="margin:0 0 16px;line-height:1.6">Click the button below to ${vars.purpose === 'signup' ? 'finish signing up' : 'sign in'}. This link expires in ${mins} minute${mins === 1 ? '' : 's'}.</p>
      <p style="margin:24px 0"><a href="${vars.url}" style="display:inline-block;background:#6c4fe0;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${verbEn(vars.purpose)}</a></p>
      <p style="font-size:13px;color:#6b6b7a;margin:24px 0 0;line-height:1.6">If the button doesn't work, paste this URL into your browser:<br><span style="word-break:break-all;color:#4a5bff">${vars.url}</span></p>
      <hr style="border:none;border-top:1px solid #e4e2ee;margin:24px 0">
      <p style="font-size:12px;color:#9b9bb0;margin:0">If you didn't request this, you can safely ignore this email.<br>— Event Pulse · <a href="https://eventpulse.com.bd" style="color:#4a5bff">eventpulse.com.bd</a></p>
    </td></tr>
  </table>
</body></html>`

  return { templateId: 'auth_magic_link', subject, text, html }
}

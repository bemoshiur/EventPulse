/**
 * Transactional template — KYC submission received.
 *
 * Per §16.3 `tenant.kyc_submitted` (acknowledgement that we got the
 * submission; reviewer queue picks it up within 24h SLA). Bilingual
 * per Decision O.2: locale comes from tenants.preferred_locale via
 * the selectLocale helper.
 *
 * Subject + body match the §16.3 catalogue naming + §22 contact info
 * (support@eventpulse.com.bd for reply-to, eventpulse.com.bd for the
 * footer link).
 *
 * Bangla copy is provisional pending counsel/native-speaker review at
 * Sprint 3 closeout. Mark = TODO_BANGLA_REVIEW only when the wording
 * is genuinely uncertain; the standard "we received your submission"
 * shape below is safe to ship as-is.
 */

export interface KycSubmittedVars {
  /** Tenant's display name — first sentence of the email is "Hi <name>". */
  tenantName: string
  /** ISO-8601 timestamp of when the submission was received (server time). */
  submittedAt: Date
  /** 'en' or 'bn'. */
  locale: 'en' | 'bn'
}

export interface RenderedEmail {
  templateId: string
  subject: string
  text: string
  html: string
}

function formatDate(d: Date, locale: 'en' | 'bn'): string {
  // Asia/Dhaka tz per §1.3 R12 for BD-facing comms.
  const fmt = new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: 'Asia/Dhaka',
    dateStyle: 'long',
    timeStyle: 'short',
  })
  return fmt.format(d)
}

export function renderKycSubmitted(vars: KycSubmittedVars): RenderedEmail {
  const stamp = formatDate(vars.submittedAt, vars.locale)

  const subject =
    vars.locale === 'bn'
      ? 'আপনার KYC আবেদন গৃহীত হয়েছে — Event Pulse'
      : 'Your KYC submission has been received — Event Pulse'

  const text =
    vars.locale === 'bn'
      ? [
          `নমস্কার ${vars.tenantName},`,
          ``,
          `আপনার KYC যাচাই আবেদন আমরা ${stamp} তারিখে গ্রহণ করেছি।`,
          ``,
          `আমাদের রিভিউয়ার দল সাধারণত ২৪ ঘণ্টার মধ্যে আবেদন পর্যালোচনা সম্পন্ন করেন। যাচাই সম্পন্ন হলে আপনাকে ইমেইলে জানানো হবে।`,
          ``,
          `প্রশ্ন থাকলে support@eventpulse.com.bd তে যোগাযোগ করুন।`,
          ``,
          `— Event Pulse`,
          `https://eventpulse.com.bd`,
        ].join('\n')
      : [
          `Hi ${vars.tenantName},`,
          ``,
          `We received your KYC verification submission at ${stamp}.`,
          ``,
          `Our reviewer team typically completes reviews within 24 hours. We'll email you once verification is complete.`,
          ``,
          `Questions? Reply to support@eventpulse.com.bd.`,
          ``,
          `— Event Pulse`,
          `https://eventpulse.com.bd`,
        ].join('\n')

  const heading = vars.locale === 'bn' ? 'আপনার KYC আবেদন গৃহীত হয়েছে' : 'KYC submission received'
  const greeting = vars.locale === 'bn' ? `নমস্কার ${vars.tenantName},` : `Hi ${vars.tenantName},`
  const body1 =
    vars.locale === 'bn'
      ? `আপনার KYC যাচাই আবেদন আমরা <strong>${stamp}</strong> তারিখে গ্রহণ করেছি।`
      : `We received your KYC verification submission at <strong>${stamp}</strong>.`
  const body2 =
    vars.locale === 'bn'
      ? `আমাদের রিভিউয়ার দল সাধারণত ২৪ ঘণ্টার মধ্যে পর্যালোচনা সম্পন্ন করেন।`
      : `Our reviewer team typically completes reviews within 24 hours. We'll email you once verification is complete.`
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
      <p style="margin:0 0 16px;line-height:1.6">${body2}</p>
      <p style="font-size:13px;color:#6b6b7a;margin:24px 0 0;line-height:1.6">${footer}</p>
      <hr style="border:none;border-top:1px solid #e4e2ee;margin:24px 0">
      <p style="font-size:12px;color:#9b9bb0;margin:0">— Event Pulse · <a href="https://eventpulse.com.bd" style="color:#4a5bff">eventpulse.com.bd</a></p>
    </td></tr>
  </table>
</body></html>`

  return { templateId: 'tenant_kyc_submitted', subject, text, html }
}

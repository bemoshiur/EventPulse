/**
 * Transactional template — KYC approved.
 *
 * Per §16.3 `tenant.kyc_approved`. Sent on the `under_review → approved`
 * transition (Item 13 reviewer decision). Bilingual per Decision O.2.
 *
 * The "what's unlocked" line is contextual on tenant type (organisation
 * vs individual) but the template stays type-agnostic and lets the
 * caller pass `tenantPortalUrl` — the CTA is "open your dashboard"
 * which works for both. Per-type wording variation lands in a future
 * PR once we have real data on what tenants expect to see.
 */

export interface KycApprovedVars {
  tenantName: string
  /** URL to the tenant portal — caller passes the right subdomain. */
  tenantPortalUrl: string
  locale: 'en' | 'bn'
}

export interface RenderedEmail {
  templateId: string
  subject: string
  text: string
  html: string
}

export function renderKycApproved(vars: KycApprovedVars): RenderedEmail {
  const subject =
    vars.locale === 'bn'
      ? 'আপনার KYC যাচাই সম্পন্ন হয়েছে — Event Pulse'
      : 'Your KYC verification is approved — Event Pulse'

  const text =
    vars.locale === 'bn'
      ? [
          `নমস্কার ${vars.tenantName},`,
          ``,
          `অভিনন্দন! আপনার KYC যাচাই সম্পন্ন হয়েছে।`,
          ``,
          `আপনি এখন আপনার ড্যাশবোর্ডে ইভেন্ট তৈরি করতে এবং পেইড টিকিট বিক্রি করতে পারবেন।`,
          ``,
          `ড্যাশবোর্ড খুলুন: ${vars.tenantPortalUrl}`,
          ``,
          `প্রশ্ন থাকলে support@eventpulse.com.bd তে যোগাযোগ করুন।`,
          ``,
          `— Event Pulse`,
          `https://eventpulse.com.bd`,
        ].join('\n')
      : [
          `Hi ${vars.tenantName},`,
          ``,
          `Good news — your KYC verification has been approved.`,
          ``,
          `You can now create events and sell paid tickets from your dashboard.`,
          ``,
          `Open your dashboard: ${vars.tenantPortalUrl}`,
          ``,
          `Questions? Reply to support@eventpulse.com.bd.`,
          ``,
          `— Event Pulse`,
          `https://eventpulse.com.bd`,
        ].join('\n')

  const heading = vars.locale === 'bn' ? 'KYC যাচাই সম্পন্ন' : 'KYC verification approved'
  const greeting = vars.locale === 'bn' ? `নমস্কার ${vars.tenantName},` : `Hi ${vars.tenantName},`
  const body1 =
    vars.locale === 'bn'
      ? `অভিনন্দন! আপনার KYC যাচাই সম্পন্ন হয়েছে।`
      : `Good news — your KYC verification has been approved.`
  const body2 =
    vars.locale === 'bn'
      ? `আপনি এখন আপনার ড্যাশবোর্ডে ইভেন্ট তৈরি করতে এবং পেইড টিকিট বিক্রি করতে পারবেন।`
      : `You can now create events and sell paid tickets from your dashboard.`
  const ctaLabel = vars.locale === 'bn' ? 'ড্যাশবোর্ড খুলুন' : 'Open dashboard'
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
      <p style="margin:24px 0"><a href="${vars.tenantPortalUrl}" style="display:inline-block;background:#19c39a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${ctaLabel}</a></p>
      <p style="font-size:13px;color:#6b6b7a;margin:24px 0 0;line-height:1.6">${footer}</p>
      <hr style="border:none;border-top:1px solid #e4e2ee;margin:24px 0">
      <p style="font-size:12px;color:#9b9bb0;margin:0">— Event Pulse · <a href="https://eventpulse.com.bd" style="color:#4a5bff">eventpulse.com.bd</a></p>
    </td></tr>
  </table>
</body></html>`

  return { templateId: 'tenant_kyc_approved', subject, text, html }
}

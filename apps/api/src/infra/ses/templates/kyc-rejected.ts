/**
 * Transactional template — KYC rejected.
 *
 * Per §16.3 `tenant.kyc_rejected`. Sent on the `under_review → rejected`
 * transition (Item 13 reviewer decision). Bilingual per Decision O.2.
 *
 * Includes the reviewer's typed reason (required ≥10 chars per Item 13)
 * and a resubmit CTA pointing at the wizard. The reason text is
 * reviewer-authored English; if the tenant's locale is bn the
 * surrounding copy is bn but the reason itself appears verbatim — a
 * reviewer-authored bn translation is out of scope for MVP.
 *
 * No PII in the reason field — Item 13 reviewer guidance constrains
 * it to category + general explanation (e.g. "NID image illegible,
 * please resubmit a clearer photo"). The §13.5 manual-verification
 * policy already documents reviewer notes don't include PII.
 */

export interface KycRejectedVars {
  tenantName: string
  /** Reviewer's typed reason (≥10 chars per Item 13 server-side check). */
  reason: string
  /** URL to the KYC resubmit wizard. */
  resubmitUrl: string
  locale: 'en' | 'bn'
}

export interface RenderedEmail {
  templateId: string
  subject: string
  text: string
  html: string
}

/**
 * Minimal HTML escape for reviewer-authored reason text. The reason is
 * not user-input from a public form (only super admins type it), but
 * defence in depth — anything that interpolates into HTML must escape.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderKycRejected(vars: KycRejectedVars): RenderedEmail {
  const subject =
    vars.locale === 'bn'
      ? 'আপনার KYC যাচাই পুনরায় জমা দিতে হবে — Event Pulse'
      : 'Action needed: KYC verification — Event Pulse'

  const text =
    vars.locale === 'bn'
      ? [
          `নমস্কার ${vars.tenantName},`,
          ``,
          `দুঃখিত, আপনার KYC যাচাই এই বার সম্পন্ন করা যায়নি।`,
          ``,
          `কারণ: ${vars.reason}`,
          ``,
          `সংশোধন করে পুনরায় জমা দিন: ${vars.resubmitUrl}`,
          ``,
          `প্রশ্ন থাকলে support@eventpulse.com.bd তে যোগাযোগ করুন।`,
          ``,
          `— Event Pulse`,
          `https://eventpulse.com.bd`,
        ].join('\n')
      : [
          `Hi ${vars.tenantName},`,
          ``,
          `We weren't able to verify your KYC submission this time.`,
          ``,
          `Reason: ${vars.reason}`,
          ``,
          `You can correct the issue and resubmit here: ${vars.resubmitUrl}`,
          ``,
          `Questions? Reply to support@eventpulse.com.bd.`,
          ``,
          `— Event Pulse`,
          `https://eventpulse.com.bd`,
        ].join('\n')

  const heading =
    vars.locale === 'bn' ? 'KYC যাচাই পুনরায় জমা দিন' : 'KYC verification needs resubmission'
  const greeting = vars.locale === 'bn' ? `নমস্কার ${vars.tenantName},` : `Hi ${vars.tenantName},`
  const body1 =
    vars.locale === 'bn'
      ? `দুঃখিত, আপনার KYC যাচাই এই বার সম্পন্ন করা যায়নি।`
      : `We weren't able to verify your KYC submission this time.`
  const reasonLabel = vars.locale === 'bn' ? 'কারণ' : 'Reason'
  const escapedReason = escapeHtml(vars.reason)
  const ctaLabel = vars.locale === 'bn' ? 'পুনরায় জমা দিন' : 'Resubmit KYC'
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
      <div style="background:#fef3f2;border-left:4px solid #ff4d7e;padding:12px 16px;border-radius:8px;margin:16px 0">
        <p style="margin:0;line-height:1.6"><strong>${reasonLabel}:</strong> ${escapedReason}</p>
      </div>
      <p style="margin:24px 0"><a href="${vars.resubmitUrl}" style="display:inline-block;background:#6c4fe0;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${ctaLabel}</a></p>
      <p style="font-size:13px;color:#6b6b7a;margin:24px 0 0;line-height:1.6">${footer}</p>
      <hr style="border:none;border-top:1px solid #e4e2ee;margin:24px 0">
      <p style="font-size:12px;color:#9b9bb0;margin:0">— Event Pulse · <a href="https://eventpulse.com.bd" style="color:#4a5bff">eventpulse.com.bd</a></p>
    </td></tr>
  </table>
</body></html>`

  return { templateId: 'tenant_kyc_rejected', subject, text, html }
}

/**
 * Transactional template — OAuth account linked.
 *
 * Per §16.3 `auth.oauth_account_linked`. Sent when an OAuth provider
 * (Google for MVP per decisions.md 2026-05-19) links to an existing
 * user — either at first sign-in via OAuth (auto-link if email matches)
 * or at later "connect OAuth" from Settings. Security signal: the user
 * knows their account has a new auth method attached; suspicious linkings
 * surface to support@.
 *
 * Bilingual per Decision O.2 — locale comes from users.locale via
 * selectLocale({userId}). Caller passes the resolved provider name +
 * the timestamp + the IP/UA snapshot for the "from <city/IP>" line.
 *
 * The IP/UA detail is optional; when omitted the email reads "from a
 * new browser" generically. Per §1.3 R5, IP rendering is /24-truncated
 * by the caller (not done here — this template assumes the IP is
 * already in display-safe form).
 */

/** Google-only at MVP per decisions.md "Apple Sign-In dropped from MVP
 *  scope" (Sprint 3 Day 23). Type retains the literal-union shape so
 *  future providers re-introduced via dedicated PR can be added here
 *  without rewriting every call site. */
export type OAuthProvider = 'google'

export interface OAuthAccountLinkedVars {
  /** User's display name. */
  userName: string
  /** Which provider was linked. */
  provider: OAuthProvider
  /** When the link happened (UTC ISO; rendered in Asia/Dhaka). */
  linkedAt: Date
  /** Optional truncated IP for the "from IP X" line (display-safe). */
  ipDisplay?: string
  /** URL to the security/settings page where the link can be revoked. */
  securitySettingsUrl: string
  locale: 'en' | 'bn'
}

export interface RenderedEmail {
  templateId: string
  subject: string
  text: string
  html: string
}

function formatDate(d: Date, locale: 'en' | 'bn'): string {
  return new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: 'Asia/Dhaka',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(d)
}

function providerLabel(p: OAuthProvider, locale: 'en' | 'bn'): string {
  // Provider names are brand-canonical; don't translate.
  void locale
  if (p === 'google') return 'Google'
  // Exhaustive guard: TS narrows to never; the throw documents intent
  // for future providers (re-introduced Apple, Microsoft, etc.) so the
  // omission surfaces at runtime rather than silently rendering empty.
  throw new Error(`Unknown OAuth provider: ${p as string}`)
}

export function renderOAuthAccountLinked(vars: OAuthAccountLinkedVars): RenderedEmail {
  const stamp = formatDate(vars.linkedAt, vars.locale)
  const provider = providerLabel(vars.provider, vars.locale)
  const ipLine =
    vars.locale === 'bn'
      ? vars.ipDisplay
        ? `IP: ${vars.ipDisplay} থেকে`
        : `নতুন ব্রাউজার থেকে`
      : vars.ipDisplay
        ? `from IP ${vars.ipDisplay}`
        : `from a new browser`

  const subject =
    vars.locale === 'bn'
      ? `${provider} আপনার Event Pulse অ্যাকাউন্টে যুক্ত হয়েছে`
      : `${provider} linked to your Event Pulse account`

  const text =
    vars.locale === 'bn'
      ? [
          `নমস্কার ${vars.userName},`,
          ``,
          `${stamp} এ ${ipLine} আপনার Event Pulse অ্যাকাউন্টে ${provider} সাইন-ইন যুক্ত হয়েছে।`,
          ``,
          `আপনি এটি না করে থাকলে এখনই নিরাপত্তা সেটিংসে গিয়ে এটি বাতিল করুন:`,
          `${vars.securitySettingsUrl}`,
          ``,
          `এবং security@eventpulse.com.bd তে যোগাযোগ করুন।`,
          ``,
          `— Event Pulse`,
          `https://eventpulse.com.bd`,
        ].join('\n')
      : [
          `Hi ${vars.userName},`,
          ``,
          `${provider} sign-in was linked to your Event Pulse account on ${stamp} ${ipLine}.`,
          ``,
          `If this wasn't you, revoke it from your security settings now:`,
          `${vars.securitySettingsUrl}`,
          ``,
          `and contact security@eventpulse.com.bd.`,
          ``,
          `— Event Pulse`,
          `https://eventpulse.com.bd`,
        ].join('\n')

  const heading =
    vars.locale === 'bn' ? `${provider} সাইন-ইন যুক্ত হয়েছে` : `${provider} sign-in linked`
  const greeting = vars.locale === 'bn' ? `নমস্কার ${vars.userName},` : `Hi ${vars.userName},`
  const body1 =
    vars.locale === 'bn'
      ? `<strong>${stamp}</strong> এ ${ipLine} আপনার Event Pulse অ্যাকাউন্টে ${provider} সাইন-ইন যুক্ত হয়েছে।`
      : `${provider} sign-in was linked to your Event Pulse account on <strong>${stamp}</strong> ${ipLine}.`
  const warn =
    vars.locale === 'bn'
      ? `আপনি এটি না করে থাকলে এখনই বাতিল করুন।`
      : `If this wasn't you, revoke it from your security settings now.`
  const ctaLabel = vars.locale === 'bn' ? 'নিরাপত্তা সেটিংস' : 'Open security settings'
  const footer =
    vars.locale === 'bn'
      ? `নিরাপত্তা সংক্রান্ত যোগাযোগ: <a href="mailto:security@eventpulse.com.bd" style="color:#4a5bff">security@eventpulse.com.bd</a>`
      : `Security contact: <a href="mailto:security@eventpulse.com.bd" style="color:#4a5bff">security@eventpulse.com.bd</a>`

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f5fb;margin:0;padding:24px;color:#2a2a36">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(20,18,60,0.06)">
    <tr><td>
      <h1 style="font-size:20px;margin:0 0 16px;color:#0b0b14">${heading}</h1>
      <p style="margin:0 0 16px;line-height:1.6">${greeting}</p>
      <p style="margin:0 0 16px;line-height:1.6">${body1}</p>
      <p style="margin:0 0 16px;line-height:1.6">${warn}</p>
      <p style="margin:24px 0"><a href="${vars.securitySettingsUrl}" style="display:inline-block;background:#6c4fe0;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${ctaLabel}</a></p>
      <p style="font-size:13px;color:#6b6b7a;margin:24px 0 0;line-height:1.6">${footer}</p>
      <hr style="border:none;border-top:1px solid #e4e2ee;margin:24px 0">
      <p style="font-size:12px;color:#9b9bb0;margin:0">— Event Pulse · <a href="https://eventpulse.com.bd" style="color:#4a5bff">eventpulse.com.bd</a></p>
    </td></tr>
  </table>
</body></html>`

  return { templateId: 'auth_oauth_account_linked', subject, text, html }
}

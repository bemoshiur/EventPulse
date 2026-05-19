import { describe, expect, it } from 'vitest'

import { renderKycRejected } from './kyc-rejected.js'

describe('kyc-rejected email template', () => {
  const resubmitUrl = 'https://acme.eventpulse.com.bd/kyc'

  it('renders English with reviewer reason + resubmit CTA', () => {
    const out = renderKycRejected({
      tenantName: 'Acme Events Ltd',
      reason: 'NID image illegible, please resubmit a clearer photo.',
      resubmitUrl,
      locale: 'en',
    })
    expect(out.templateId).toBe('tenant_kyc_rejected')
    expect(out.subject).toMatch(/Action needed: KYC verification/i)
    expect(out.text).toContain('Hi Acme Events Ltd,')
    expect(out.text).toContain('Reason: NID image illegible, please resubmit a clearer photo.')
    expect(out.text).toContain(resubmitUrl)
    expect(out.html).toContain(`href="${resubmitUrl}"`)
    expect(out.html).toContain('Resubmit KYC')
  })

  it('renders Bangla variant; reason text appears verbatim (reviewer-authored EN per spec)', () => {
    const out = renderKycRejected({
      tenantName: 'Acme',
      reason: 'NID image illegible',
      resubmitUrl,
      locale: 'bn',
    })
    expect(out.subject).toContain('পুনরায় জমা দিতে হবে')
    expect(out.text).toContain('নমস্কার Acme')
    expect(out.text).toContain('কারণ: NID image illegible')
    expect(out.html).toContain('পুনরায় জমা দিন')
  })

  it('escapes HTML in the reviewer reason (XSS defence)', () => {
    const out = renderKycRejected({
      tenantName: 'Acme',
      reason: '<script>alert(1)</script> please retry',
      resubmitUrl,
      locale: 'en',
    })
    expect(out.html).not.toContain('<script>')
    expect(out.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    // Text version is intentionally unchanged (no HTML interpretation in plain text)
    expect(out.text).toContain('<script>alert(1)</script>')
  })

  it('escapes &, ", \' in reason', () => {
    const out = renderKycRejected({
      tenantName: 'Acme',
      reason: `R&D's "blurry" photo`,
      resubmitUrl,
      locale: 'en',
    })
    expect(out.html).toContain('R&amp;D&#39;s &quot;blurry&quot; photo')
  })
})

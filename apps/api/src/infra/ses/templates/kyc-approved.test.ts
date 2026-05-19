import { describe, expect, it } from 'vitest'

import { renderKycApproved } from './kyc-approved.js'

describe('kyc-approved email template', () => {
  const portalUrl = 'https://acme.eventpulse.com.bd/dashboard'

  it('renders English subject + body with CTA to tenant portal', () => {
    const out = renderKycApproved({
      tenantName: 'Acme Events Ltd',
      tenantPortalUrl: portalUrl,
      locale: 'en',
    })
    expect(out.templateId).toBe('tenant_kyc_approved')
    expect(out.subject).toMatch(/KYC verification is approved/i)
    expect(out.text).toContain('Hi Acme Events Ltd,')
    expect(out.text).toMatch(/has been approved/i)
    expect(out.text).toContain(portalUrl)
    expect(out.html).toContain(`href="${portalUrl}"`)
    expect(out.html).toContain('Open dashboard')
  })

  it('renders Bangla variant', () => {
    const out = renderKycApproved({
      tenantName: 'Acme Events Ltd',
      tenantPortalUrl: portalUrl,
      locale: 'bn',
    })
    expect(out.subject).toContain('আপনার KYC যাচাই সম্পন্ন')
    expect(out.text).toContain('অভিনন্দন')
    expect(out.text).toContain(portalUrl)
    expect(out.html).toContain('ড্যাশবোর্ড খুলুন')
  })
})

import { describe, expect, it } from 'vitest'

import { renderKycSubmitted } from './kyc-submitted.js'

const FIXED_SUBMITTED_AT = new Date('2026-05-20T08:30:00Z')

describe('kyc-submitted email template', () => {
  it('renders English subject + body with tenant name + formatted timestamp', () => {
    const out = renderKycSubmitted({
      tenantName: 'Acme Events Ltd',
      submittedAt: FIXED_SUBMITTED_AT,
      locale: 'en',
    })
    expect(out.templateId).toBe('tenant_kyc_submitted')
    expect(out.subject).toMatch(/Your KYC submission has been received/i)
    expect(out.text).toContain('Hi Acme Events Ltd,')
    expect(out.text).toMatch(/We received your KYC verification submission at/)
    // Asia/Dhaka timezone (UTC+6) → "08:30 UTC" = "14:30 Dhaka"; assert the
    // hour shifted correctly without binding to Intl formatting cosmetics.
    expect(out.text).toMatch(/14:30/)
    expect(out.text).toContain('support@eventpulse.com.bd')
    expect(out.html).toContain('Acme Events Ltd')
    expect(out.html).toContain('eventpulse.com.bd')
  })

  it('renders Bangla subject + body when locale=bn', () => {
    const out = renderKycSubmitted({
      tenantName: 'Acme Events Ltd',
      submittedAt: FIXED_SUBMITTED_AT,
      locale: 'bn',
    })
    expect(out.subject).toContain('আপনার KYC আবেদন গৃহীত হয়েছে')
    expect(out.text).toContain('নমস্কার Acme Events Ltd')
    expect(out.text).toContain('support@eventpulse.com.bd')
  })

  it('preserves tenant name with apostrophe + non-ASCII chars', () => {
    const out = renderKycSubmitted({
      tenantName: "Café d'Été — পাবলিক পালস",
      submittedAt: FIXED_SUBMITTED_AT,
      locale: 'en',
    })
    expect(out.text).toContain("Café d'Été — পাবলিক পালস")
  })
})

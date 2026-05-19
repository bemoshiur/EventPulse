import { describe, expect, it } from 'vitest'

import { renderOAuthAccountLinked } from './oauth-account-linked.js'

const LINKED_AT = new Date('2026-05-20T14:00:00Z')

describe('oauth-account-linked email template', () => {
  const securityUrl = 'https://app.eventpulse.com.bd/settings/security'

  it('renders English subject + body with provider name + IP detail', () => {
    const out = renderOAuthAccountLinked({
      userName: 'Aisha Khan',
      provider: 'google',
      linkedAt: LINKED_AT,
      ipDisplay: '203.112.10.0/24',
      securitySettingsUrl: securityUrl,
      locale: 'en',
    })
    expect(out.templateId).toBe('auth_oauth_account_linked')
    expect(out.subject).toMatch(/Google linked to your Event Pulse account/)
    expect(out.text).toContain('Hi Aisha Khan,')
    expect(out.text).toMatch(/Google sign-in was linked/)
    expect(out.text).toContain('from IP 203.112.10.0/24')
    expect(out.text).toContain(securityUrl)
    expect(out.text).toContain('security@eventpulse.com.bd')
    expect(out.html).toContain('Open security settings')
  })

  it('renders Bangla variant', () => {
    const out = renderOAuthAccountLinked({
      userName: 'আয়েশা',
      provider: 'google',
      linkedAt: LINKED_AT,
      securitySettingsUrl: securityUrl,
      locale: 'bn',
    })
    expect(out.subject).toContain('Google আপনার Event Pulse অ্যাকাউন্টে যুক্ত হয়েছে')
    expect(out.text).toContain('নমস্কার আয়েশা')
    expect(out.text).toContain('নতুন ব্রাউজার থেকে') // ipDisplay omitted → generic line
  })

  it('omits IP detail when ipDisplay is not provided (English variant)', () => {
    const out = renderOAuthAccountLinked({
      userName: 'Aisha Khan',
      provider: 'google',
      linkedAt: LINKED_AT,
      securitySettingsUrl: securityUrl,
      locale: 'en',
    })
    expect(out.text).toMatch(/from a new browser/)
    expect(out.text).not.toMatch(/from IP /)
  })

  it('uses brand-canonical "Apple" label regardless of locale', () => {
    const out = renderOAuthAccountLinked({
      userName: 'Aisha',
      provider: 'apple',
      linkedAt: LINKED_AT,
      securitySettingsUrl: securityUrl,
      locale: 'bn',
    })
    expect(out.subject).toContain('Apple')
    expect(out.text).toContain('Apple সাইন-ইন যুক্ত হয়েছে')
  })
})

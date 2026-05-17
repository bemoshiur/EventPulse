import { describe, expect, it } from 'vitest'

import { renderMagicLink } from './magic-link.js'

describe('magic-link email template', () => {
  it('renders subject + text + html for signin (English default)', () => {
    const out = renderMagicLink({
      url: 'https://staging.eventpulse.com.bd/auth/magic?token=abc',
      expiresAt: new Date(Date.now() + 14 * 60_000),
      purpose: 'signin',
    })
    expect(out.templateId).toBe('auth_magic_link')
    expect(out.subject).toMatch(/Sign in to Event Pulse/i)
    expect(out.text).toContain('https://staging.eventpulse.com.bd/auth/magic?token=abc')
    expect(out.text).toContain('14 minutes')
    expect(out.html).toContain('Sign in')
    expect(out.html).toContain('https://staging.eventpulse.com.bd/auth/magic?token=abc')
  })

  it('uses the "finish signing up" verb when purpose=signup', () => {
    const out = renderMagicLink({
      url: 'https://example.com',
      expiresAt: new Date(Date.now() + 60_000),
      purpose: 'signup',
    })
    expect(out.subject).toMatch(/Finish signing up/i)
  })

  it('renders Bangla subject when locale=bn', () => {
    const out = renderMagicLink({
      url: 'https://example.com',
      expiresAt: new Date(Date.now() + 60_000),
      purpose: 'signin',
      locale: 'bn',
    })
    expect(out.subject).toContain('সাইন ইন করুন')
    expect(out.text).toContain('নমস্কার')
  })

  it('singular minute when 1 minute remaining', () => {
    const out = renderMagicLink({
      url: 'https://example.com',
      expiresAt: new Date(Date.now() + 30_000),
      purpose: 'signin',
    })
    expect(out.text).toContain('1 minute ')
    expect(out.text).not.toContain('1 minutes')
  })

  it('clamps below-zero minutes to at-least-1', () => {
    const out = renderMagicLink({
      url: 'https://example.com',
      expiresAt: new Date(Date.now() - 5_000),
      purpose: 'signin',
    })
    expect(out.text).toMatch(/1 minute/)
  })
})

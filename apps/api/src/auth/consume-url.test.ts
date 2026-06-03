/**
 * Magic-link consume-URL builder tests — browser-auth integration (Day 46, step 6).
 *
 * The link must point at the portal the user is signing in from (the request
 * Origin) — but ONLY if that origin is allow-listed, otherwise an attacker could
 * coax the API into emailing a link to their host. Audience travels in the link
 * (server-enforced by the #267 grant check at consume; not a secret). Pure.
 */

import { describe, expect, it } from 'vitest'

import { buildConsumeUrl, resolveConsumeBase } from './consume-url.js'

const ALLOW = ['https://app.eventpulse.com.bd', 'https://admin.eventpulse.com.bd']
const FALLBACK = 'https://app.eventpulse.com.bd'

describe('magic-link consume URL', () => {
  it('uses the request Origin when it is allow-listed', () => {
    expect(resolveConsumeBase('https://admin.eventpulse.com.bd', ALLOW, FALLBACK)).toBe(
      'https://admin.eventpulse.com.bd',
    )
  })

  it('falls back when the Origin header is absent', () => {
    expect(resolveConsumeBase(undefined, ALLOW, FALLBACK)).toBe(FALLBACK)
  })

  it('falls back when the Origin is NOT allow-listed (no open redirect to attacker host)', () => {
    expect(resolveConsumeBase('https://evil.example.com', ALLOW, FALLBACK)).toBe(FALLBACK)
  })

  it('builds the consume URL with url-encoded token + purpose + audience', () => {
    const url = buildConsumeUrl({
      base: 'https://admin.eventpulse.com.bd',
      token: 'a/b+c=',
      purpose: 'signin',
      audience: 'super-admin',
    })
    expect(url).toBe(
      'https://admin.eventpulse.com.bd/auth/magic?token=a%2Fb%2Bc%3D&purpose=signin&audience=super-admin',
    )
  })
})

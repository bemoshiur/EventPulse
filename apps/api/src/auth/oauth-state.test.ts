import { describe, expect, it } from 'vitest'

import {
  buildClearCookie,
  buildSetCookie,
  deriveStateHmacKey,
  signState,
  stateCookieName,
  verifyState,
} from './oauth-state.js'

const SECRET = 'x'.repeat(64) // ≥ 32 chars; deriveStateHmacKey requires it
const KEY = deriveStateHmacKey(SECRET)

describe('oauth-state: signState + verifyState happy path', () => {
  it('round-trips a Google payload', () => {
    const nowSec = 1_700_000_000
    const cookie = signState(
      { state: 'st-google', codeVerifier: 'cv-google', provider: 'google' },
      { key: KEY, nowSec, ttlSec: 600 },
    )
    const result = verifyState(cookie, 'google', 'st-google', { key: KEY, nowSec })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.state).toBe('st-google')
      expect(result.payload.codeVerifier).toBe('cv-google')
      expect(result.payload.provider).toBe('google')
      expect(result.payload.exp).toBe(nowSec + 600)
    }
  })

  it('round-trips an Apple payload with empty codeVerifier', () => {
    const cookie = signState(
      { state: 'st-apple', codeVerifier: '', provider: 'apple' },
      { key: KEY },
    )
    const result = verifyState(cookie, 'apple', 'st-apple', { key: KEY })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.codeVerifier).toBe('')
      expect(result.payload.provider).toBe('apple')
    }
  })
})

describe('oauth-state: tamper detection', () => {
  it('detects flipped payload byte', () => {
    const cookie = signState({ state: 's', codeVerifier: 'v', provider: 'google' }, { key: KEY })
    const [b64, sig] = cookie.split('.') as [string, string]
    // Flip one char in the payload b64 — signature now mismatches.
    const tamperedFirst = b64[0] === 'A' ? 'B' : 'A'
    const tampered = `${tamperedFirst}${b64.slice(1)}.${sig}`
    const result = verifyState(tampered, 'google', 's', { key: KEY })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Either bad_signature (most likely) or malformed (if the flip
      // happened to land in valid base64 alphabet) — both are correct
      // failure modes for tampered input.
      expect(['bad_signature', 'malformed', 'invalid_payload']).toContain(result.error)
    }
  })

  it('rejects a cookie signed with a different key', () => {
    const cookie = signState({ state: 's', codeVerifier: 'v', provider: 'google' }, { key: KEY })
    const otherKey = deriveStateHmacKey('y'.repeat(64))
    const result = verifyState(cookie, 'google', 's', { key: otherKey })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('bad_signature')
  })

  it('rejects malformed (no dot separator)', () => {
    const result = verifyState('abc-no-dot', 'google', 's', { key: KEY })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('malformed')
  })

  it('rejects an empty/null cookie value', () => {
    expect(verifyState(undefined, 'google', 's', { key: KEY }).ok).toBe(false)
    expect(verifyState(null, 'google', 's', { key: KEY }).ok).toBe(false)
    expect(verifyState('', 'google', 's', { key: KEY }).ok).toBe(false)
  })
})

describe('oauth-state: TTL', () => {
  it('rejects expired payload', () => {
    const cookie = signState(
      { state: 's', codeVerifier: 'v', provider: 'google' },
      { key: KEY, ttlSec: 60, nowSec: 1_000 },
    )
    const result = verifyState(cookie, 'google', 's', { key: KEY, nowSec: 1_061 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('expired')
  })

  it('accepts payload one second before expiry', () => {
    const cookie = signState(
      { state: 's', codeVerifier: 'v', provider: 'google' },
      { key: KEY, ttlSec: 60, nowSec: 1_000 },
    )
    const result = verifyState(cookie, 'google', 's', { key: KEY, nowSec: 1_059 })
    expect(result.ok).toBe(true)
  })
})

describe('oauth-state: provider + state binding', () => {
  it('rejects when expected provider differs from payload provider', () => {
    const cookie = signState({ state: 's', codeVerifier: 'v', provider: 'google' }, { key: KEY })
    const result = verifyState(cookie, 'apple', 's', { key: KEY })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('provider_mismatch')
  })

  it('rejects when state nonce in payload differs from IdP-returned state', () => {
    const cookie = signState(
      { state: 'expected', codeVerifier: 'v', provider: 'google' },
      { key: KEY },
    )
    const result = verifyState(cookie, 'google', 'attacker-state', { key: KEY })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('bad_signature')
  })

  it('rejects when no IdP state was provided', () => {
    const cookie = signState(
      { state: 'expected', codeVerifier: 'v', provider: 'google' },
      { key: KEY },
    )
    const result = verifyState(cookie, 'google', null, { key: KEY })
    expect(result.ok).toBe(false)
  })
})

describe('oauth-state: deriveStateHmacKey rejects short secrets', () => {
  it('throws when JWT_ACCESS_SECRET shorter than 32 chars', () => {
    expect(() => deriveStateHmacKey('too-short')).toThrow(/at least 32/)
  })
  it('domain-separates from raw secret (different bytes)', () => {
    const k1 = deriveStateHmacKey('a'.repeat(64))
    const k2 = deriveStateHmacKey('b'.repeat(64))
    expect(k1.equals(k2)).toBe(false)
  })
})

describe('oauth-state: cookie name + Set-Cookie helpers', () => {
  it('stateCookieName is provider-specific', () => {
    expect(stateCookieName('google')).toBe('oauth_state_google')
    expect(stateCookieName('apple')).toBe('oauth_state_apple')
  })

  it('buildSetCookie includes HttpOnly + SameSite=Lax + Path=/ + Max-Age', () => {
    const c = buildSetCookie('oauth_state_google', 'abc.def', { secure: true, ttlSec: 600 })
    expect(c).toContain('HttpOnly')
    expect(c).toContain('SameSite=Lax')
    expect(c).toContain('Path=/')
    expect(c).toContain('Max-Age=600')
    expect(c).toContain('Secure')
    expect(c.startsWith('oauth_state_google=abc.def')).toBe(true)
  })

  it('buildSetCookie omits Secure when secure=false (dev/local)', () => {
    const c = buildSetCookie('oauth_state_google', 'abc.def', { secure: false })
    expect(c).not.toContain('Secure')
  })

  it('buildClearCookie has Max-Age=0 and empty value', () => {
    const c = buildClearCookie('oauth_state_google', { secure: true })
    expect(c).toContain('Max-Age=0')
    expect(c).toContain('oauth_state_google=;')
    expect(c).toContain('Secure')
  })
})

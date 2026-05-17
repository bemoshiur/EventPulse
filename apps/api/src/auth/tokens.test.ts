import { describe, expect, it } from 'vitest'

import { generateToken, hashToken, ipv4Prefix24 } from './tokens.js'

describe('opaque tokens', () => {
  it('generates 256-bit base64url tokens', () => {
    const t = generateToken()
    // 32 bytes -> base64url length 43 (no padding)
    expect(t.length).toBe(43)
    expect(/^[A-Za-z0-9_-]+$/.test(t)).toBe(true)
  })

  it('successive tokens are unique', () => {
    const set = new Set<string>()
    for (let i = 0; i < 1000; i++) set.add(generateToken())
    expect(set.size).toBe(1000)
  })

  it('hashToken is deterministic SHA-256 hex', () => {
    expect(hashToken('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })

  it('hashToken differs for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'))
  })
})

describe('ipv4Prefix24', () => {
  it('returns /24 prefix for valid IPv4', () => {
    expect(ipv4Prefix24('192.168.1.42')).toBe('192.168.1.0/24')
    expect(ipv4Prefix24('103.230.105.7')).toBe('103.230.105.0/24')
  })

  it('returns null for IPv6 + garbage + missing input', () => {
    expect(ipv4Prefix24('::1')).toBeNull()
    expect(ipv4Prefix24('2001:db8::1')).toBeNull()
    expect(ipv4Prefix24('not-an-ip')).toBeNull()
    expect(ipv4Prefix24('256.0.0.1')).toBeNull()
    expect(ipv4Prefix24(null)).toBeNull()
    expect(ipv4Prefix24(undefined)).toBeNull()
  })
})

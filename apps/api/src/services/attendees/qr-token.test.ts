/**
 * QR token mint — pure unit tests.
 *
 * Pinned properties:
 *
 *   1. Shape: 43-char base64url (no padding); only [A-Za-z0-9_-].
 *   2. Deterministic for a given byte input (pure function).
 *   3. Distinct inputs produce distinct tokens (no collapsing).
 *   4. Production wrapper produces 1000 distinct tokens (no
 *      practical collision at this scale).
 *   5. Insufficient random bytes raise — defense in depth against a
 *      misconfigured caller passing a short seed.
 */

import { describe, expect, it } from 'vitest'

import { mintQrToken, mintQrTokenPure } from './qr-token.js'

describe('mintQrTokenPure', () => {
  it('returns a 43-char base64url string for 32-byte input', () => {
    const token = mintQrTokenPure(new Uint8Array(32))
    expect(token).toHaveLength(43)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('is deterministic — same bytes produce same token', () => {
    const bytes = new Uint8Array(32).fill(0xab)
    expect(mintQrTokenPure(bytes)).toBe(mintQrTokenPure(bytes))
  })

  it('different bytes produce different tokens', () => {
    const a = mintQrTokenPure(new Uint8Array(32).fill(0x00))
    const b = mintQrTokenPure(new Uint8Array(32).fill(0xff))
    expect(a).not.toBe(b)
  })

  it('uses the first 32 bytes only (extra bytes ignored)', () => {
    const a = mintQrTokenPure(new Uint8Array(32).fill(0x01))
    const longer = new Uint8Array(64)
    longer.fill(0x01, 0, 32)
    longer.fill(0xff, 32, 64)
    const b = mintQrTokenPure(longer)
    expect(a).toBe(b)
  })

  it('throws if fewer than 32 bytes provided — defends against misconfigured callers', () => {
    expect(() => mintQrTokenPure(new Uint8Array(8))).toThrowError(/>= 32 bytes/)
    expect(() => mintQrTokenPure(new Uint8Array(31))).toThrowError(/>= 32 bytes/)
  })

  it('does NOT include base64 padding character (=)', () => {
    // base64url omits '=' padding — the QR encoder + URL routing
    // are happier with no '=' in the token.
    const token = mintQrTokenPure(new Uint8Array(32).fill(0x7f))
    expect(token).not.toContain('=')
  })

  it('uses URL-safe alphabet — no + or / characters', () => {
    // base64url replaces '+' with '-' and '/' with '_'.
    const token = mintQrTokenPure(new Uint8Array(32).fill(0xfb))
    expect(token).not.toContain('+')
    expect(token).not.toContain('/')
  })
})

describe('mintQrToken (production wrapper)', () => {
  it('produces 1000 distinct tokens — no practical collision', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      tokens.add(mintQrToken())
    }
    expect(tokens.size).toBe(1000)
  })

  it('every token matches the documented shape', () => {
    for (let i = 0; i < 50; i++) {
      const token = mintQrToken()
      expect(token).toHaveLength(43)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })
})

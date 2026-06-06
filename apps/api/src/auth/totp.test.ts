import { describe, expect, it } from 'vitest'

import {
  base32Encode,
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from './totp.js'

describe('TOTP', () => {
  it('a freshly generated code verifies', () => {
    const secret = generateTotpSecret()
    const code = generateTotp(secret)
    expect(verifyTotp(secret, code)).toBe(true)
  })

  it('RFC 6238 vector — SHA-1 secret "12345678901234567890" at T=59 → 287082', () => {
    // The classic RFC test secret is ASCII "12345678901234567890" (20 bytes).
    const secret = base32Encode(new TextEncoder().encode('12345678901234567890'))
    expect(generateTotp(secret, 59_000)).toBe('287082')
  })

  it('rejects a wrong code', () => {
    const secret = generateTotpSecret()
    expect(verifyTotp(secret, '000000', 1, 0)).toBe(false)
  })

  it('accepts a code from the previous 30s step (drift window)', () => {
    const secret = generateTotpSecret()
    const now = 1_000_000_000_000
    const prevStepCode = generateTotp(secret, now - 30_000)
    expect(verifyTotp(secret, prevStepCode, 1, now)).toBe(true)
  })

  it('rejects a non-6-digit input', () => {
    const secret = generateTotpSecret()
    expect(verifyTotp(secret, '12345')).toBe(false)
    expect(verifyTotp(secret, 'abcdef')).toBe(false)
  })

  it('otpauth URI carries the secret + issuer', () => {
    const uri = buildOtpauthUri('buyer@example.com', 'JBSWY3DPEHPK3PXP')
    expect(uri).toContain('otpauth://totp/')
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(uri).toContain('issuer=Event+Pulse')
  })

  it('recovery codes hash deterministically (case/format-insensitive)', () => {
    const { codes, hashes } = generateRecoveryCodes()
    expect(codes).toHaveLength(8)
    expect(hashes).toHaveLength(8)
    expect(hashRecoveryCode(codes[0]!.toUpperCase())).toBe(hashes[0])
    expect(hashRecoveryCode(codes[0]!.replace('-', ''))).toBe(hashes[0])
  })

  it('recovery codes are ≥128-bit entropy AND fit the auth code schema bounds [6,40]', () => {
    // Regression guard: the /mfa/* `code` field is validated as min(6).max(40).
    // A recovery code that overflows that bound is silently un-enterable.
    const { codes } = generateRecoveryCodes()
    for (const code of codes) {
      expect(code.replace(/-/g, '').length).toBeGreaterThanOrEqual(32) // 128 bits as hex
      expect(code.length).toBeGreaterThanOrEqual(6)
      expect(code.length).toBeLessThanOrEqual(40)
    }
  })
})

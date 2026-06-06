/**
 * TOTP (RFC 6238) + HOTP (RFC 4226) implemented in-house via @noble/hashes —
 * consistent with the rolled-our-own auth philosophy (§5.3); no new dependency.
 *
 * - 30-second step, 6 digits, SHA-1 (the authenticator-app default).
 * - Verification allows a ±1 step window for clock drift.
 * - Secrets are base32 (RFC 4648, no padding) so they paste into any app.
 * - Recovery codes: 8 single-use codes; only their SHA-256 hashes are stored.
 */

import { hmac } from '@noble/hashes/hmac'
import { sha1 } from '@noble/hashes/sha1'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex, randomBytes } from '@noble/hashes/utils'

const STEP_SECONDS = 30
const DIGITS = 6
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

// ─── base32 ───────────────────────────────────────────────────────────

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '').toUpperCase().replace(/\s/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

// ─── TOTP ─────────────────────────────────────────────────────────────

/** Generate a fresh base32 TOTP secret (160 bits). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

function counterBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8)
  let n = counter
  for (let i = 7; i >= 0; i--) {
    buf[i] = n & 0xff
    n = Math.floor(n / 256)
  }
  return buf
}

function hotp(secret: Uint8Array, counter: number): string {
  const mac = hmac(sha1, secret, counterBytes(counter))
  const offset = mac[mac.length - 1]! & 0x0f
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff)
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0')
}

/** Current TOTP code for a base32 secret (for tests / display). */
export function generateTotp(base32Secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS)
  return hotp(base32Decode(base32Secret), counter)
}

/**
 * Verify a user-entered code against the secret, allowing ±`window` steps for
 * clock drift. Returns true on the first matching step. Constant-ish: checks
 * all candidate steps regardless of an early match would be marginally better,
 * but TOTP brute-force is rate-limited by the 6-digit space + login throttling.
 */
export function verifyTotp(
  base32Secret: string,
  code: string,
  window = 1,
  atMs: number = Date.now(),
): boolean {
  const cleaned = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(cleaned)) return false
  const secret = base32Decode(base32Secret)
  const base = Math.floor(atMs / 1000 / STEP_SECONDS)
  for (let w = -window; w <= window; w++) {
    if (hotp(secret, base + w) === cleaned) return true
  }
  return false
}

/** otpauth:// provisioning URI for the authenticator-app QR. */
export function buildOtpauthUri(accountEmail: string, base32Secret: string): string {
  const issuer = 'Event Pulse'
  const label = encodeURIComponent(`${issuer}:${accountEmail}`)
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

// ─── recovery codes ───────────────────────────────────────────────────

const RECOVERY_COUNT = 8

export function hashRecoveryCode(code: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(code.replace(/[\s-]/g, '').toLowerCase())))
}

/** Generate plaintext recovery codes (show once) + their stored hashes. */
export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes: string[] = []
  for (let i = 0; i < RECOVERY_COUNT; i++) {
    const raw = bytesToHex(randomBytes(5)) // 10 hex chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`)
  }
  return { codes, hashes: codes.map(hashRecoveryCode) }
}

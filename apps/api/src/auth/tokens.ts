/**
 * Opaque session tokens + magic-link tokens.
 *
 * Two helpers:
 * - `generateSessionToken` returns a 256-bit random token, base64url
 *   encoded. The plaintext is sent to the client (set as HttpOnly
 *   cookie); the SHA-256 hash is what we store in the sessions table.
 * - `hashToken` is the one-way SHA-256 used for both session token
 *   storage and magic-link token storage.
 *
 * Storing only the hash means a DB leak doesn't reveal active sessions.
 */

import { createHash, randomBytes } from 'node:crypto'

const TOKEN_BYTES = 32 // 256 bits

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * IP -> /24 prefix string, used for magic-link "bind to requesting
 * network" check per §5.2. Returns null for IPv6 or unparseable input
 * (we don't bind IPv6 in v1 — too much subnet variance for honest
 * mobile users).
 */
export function ipv4Prefix24(ip: string | null | undefined): string | null {
  if (!ip) return null
  const parts = ip.split('.').map((x) => Number(x))
  if (parts.length !== 4) return null
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
}

/**
 * Argon2id password hashing per CLAUDE.md §5.2.
 *
 * Uses the pure-JS implementation from @noble/hashes (no native build
 * step, well-audited). Parameters chosen for the OWASP-recommended
 * minimum: m=64 MiB, t=3, p=4. These can be tuned per CPU profile but
 * stay roughly in the "interactive login feels instant" envelope.
 *
 * Encoded format mirrors the canonical PHC string so we can swap to
 * `@node-rs/argon2` (native bindings) later if hashing throughput
 * becomes a bottleneck, with no DB migration needed:
 *
 *   $argon2id$v=19$m=65536,t=3,p=4$<base64-salt>$<base64-hash>
 */

import { argon2id } from '@noble/hashes/argon2'
import { randomBytes, timingSafeEqual } from 'node:crypto'

const PARAMS = { m: 65_536, t: 3, p: 4, dkLen: 32 } as const
const SALT_LEN = 16

function b64(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '')
}

function fromB64(s: string): Uint8Array {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4)
  return new Uint8Array(Buffer.from(padded, 'base64'))
}

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 8) {
    throw new RangeError('password must be at least 8 characters')
  }
  const salt = new Uint8Array(randomBytes(SALT_LEN))
  const hash = argon2id(password, salt, PARAMS)
  return `$argon2id$v=19$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${b64(salt)}$${b64(hash)}`
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  // Encoded format: $argon2id$v=19$m=...,t=...,p=...$salt$hash
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[1] !== 'argon2id' || parts[2] !== 'v=19') {
    return false
  }
  const paramsStr = parts[3]!
  const saltStr = parts[4]!
  const hashStr = parts[5]!
  const params = Object.fromEntries(
    paramsStr.split(',').map((kv) => {
      const [k, v] = kv.split('=') as [string, string]
      return [k, Number(v)]
    }),
  ) as { m: number; t: number; p: number }

  const salt = fromB64(saltStr)
  const expected = fromB64(hashStr)
  const computed = argon2id(password, salt, { ...params, dkLen: expected.length })

  if (computed.length !== expected.length) return false
  return timingSafeEqual(computed, expected)
}

/** Constant-time compare for non-hash secrets (CSRF tokens, magic-link hashes). */
export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

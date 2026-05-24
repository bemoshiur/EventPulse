/**
 * EPS payload signing — HMAC-SHA512 per CLAUDE.md §11.4.
 *
 * EPS V5 uses HMAC-SHA512 over a single string field per endpoint,
 * keyed by `EPS_HASH_KEY`. The hash is included in the request as the
 * `x-hash` header. Mechanism varies per endpoint:
 *
 *   - GetToken                          → hashes `userName`
 *   - InitializeEPS                     → hashes `merchantTransactionId`
 *   - CheckMerchantTransactionStatus    → hashes `merchantTransactionId`
 *                                          OR `EPSTransactionId`
 *
 * Output format is lowercase-hex (128 chars for SHA-512). EPS rejects
 * uppercase-hex or base64.
 *
 * v1 `@noble/hashes` import paths used (bare specifiers, no `.js`
 * suffix) per `.claude/memory/decisions.md` "@noble/hashes 1.8.0 →
 * 2.2.0 deferred to post-Days-24-25-EPS-truth-gate" (2026-05-24). When
 * #72 reopens post-truth-gate, all three imports become
 * `'@noble/hashes/hmac.js'`, `'@noble/hashes/sha2.js'`,
 * `'@noble/hashes/utils.js'` (v2 `exports` field drops bare-specifier
 * resolution).
 */

import { hmac } from '@noble/hashes/hmac'
import { sha512 } from '@noble/hashes/sha512'
import { bytesToHex } from '@noble/hashes/utils'

const encoder = new TextEncoder()

/**
 * Sign a string field per EPS V5 spec — HMAC-SHA512(payload, EPS_HASH_KEY)
 * → lowercase-hex. Pure function; no I/O; deterministic.
 *
 * @param value the string field whose hash EPS expects (varies per endpoint;
 *              see §11.4 mechanism table).
 * @param key   the EPS_HASH_KEY string from secrets (treated as UTF-8 bytes
 *              for HMAC key derivation).
 */
export function signEpsField(value: string, key: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`value must be a string; received ${typeof value}`)
  }
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError('key must be a non-empty string')
  }
  return bytesToHex(hmac(sha512, encoder.encode(key), encoder.encode(value)))
}

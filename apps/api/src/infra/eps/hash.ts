/**
 * EPS payload signing — HMAC-SHA512 per CLAUDE.md §11.4 + the EPS V4
 * sandbox integration guide (Postman x-hash samples are 88-char Base64
 * with `+`/`/`/`==` padding; decode to 64 bytes = SHA-512 output).
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
 * Output format is **Base64** (standard alphabet with `+` / `/` and
 * `=` padding — 88 chars for SHA-512's 64-byte output). EPS rejects
 * hex. This was caught at Day-36 truth-gate pre-flight (the V4 spec
 * + Postman samples were the ground truth; an earlier comment in this
 * file claimed hex was the format — which would have been rejected
 * by the very first GetToken call against either sandbox or prod).
 *
 * v1 `@noble/hashes` import paths used (bare specifiers, no `.js`
 * suffix) per `.claude/memory/decisions.md` "@noble/hashes 1.8.0 →
 * 2.2.0 deferred to post-Days-24-25-EPS-truth-gate" (2026-05-24). When
 * #72 reopens post-truth-gate, the two remaining imports become
 * `'@noble/hashes/hmac.js'` + `'@noble/hashes/sha512.js'` (v2 `exports`
 * field drops bare-specifier resolution). `bytesToHex` is no longer
 * imported — Base64 encoding runs through Node's Buffer, which is
 * always available in the api runtime; one fewer noble subpath to
 * migrate at v2 bump.
 */

import { hmac } from '@noble/hashes/hmac'
import { sha512 } from '@noble/hashes/sha512'

const encoder = new TextEncoder()

/**
 * Sign a string field per EPS V5 spec — HMAC-SHA512(payload, EPS_HASH_KEY)
 * → Base64. Pure function; no I/O; deterministic.
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
  return Buffer.from(hmac(sha512, encoder.encode(key), encoder.encode(value))).toString('base64')
}

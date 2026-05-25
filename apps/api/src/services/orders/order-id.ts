/**
 * `merchantTransactionId` mint helper.
 *
 * Per CLAUDE.md §11.4 + §11.5:
 *   - globally unique per merchant
 *   - minimum 10 characters
 *   - Recommended shape: `TXN-${timestamp}-${tenantSlugShort}-${random}`
 *
 * Our generator: `TXN-{base36 ms-since-epoch}-{tenantSlugShort 8}-{random 8}`
 * → e.g. `TXN-lwq2x9k0-acmecorp-7gh5dq3z` (35-40 chars typical).
 *
 * Collision protection: 8 chars of crypto random + 8-char timestamp gives
 * ~36^16 = 7.9 × 10^24 space per ms, well beyond birthday-paradox concern
 * at MVP scale. The `merchant_transaction_id` UNIQUE constraint on
 * `orders` is the hard backstop — collision would surface as a DB
 * UNIQUE violation, not a silent collision.
 *
 * Pure function: takes (tenantSlug, now, randomBytes) so it's
 * deterministic for tests; `mintMerchantTransactionId()` is the
 * narrow production wrapper that sources `now` from `Date.now()` and
 * `randomBytes` from `crypto`.
 */

import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz' // base-36

/**
 * Base-36 encode a non-negative integer to a string of EXACTLY the
 * given length (left-padded with '0' if needed).
 */
function toBase36Padded(value: number, length: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`value must be a non-negative finite number; received ${value}`)
  }
  const raw = value.toString(36)
  return raw.length >= length ? raw.slice(-length) : raw.padStart(length, '0')
}

/**
 * Map a random byte to a base-36 alphabet char.
 */
function byteToB36Char(byte: number): string {
  return ALPHABET[byte % 36]!
}

/**
 * Strip + truncate a tenant slug into the merchantTransactionId
 * tenant-segment. Lowercase, alphanumeric only, max 8 chars. Empty
 * input → 'tenant'.
 */
export function tenantSlugSegment(slug: string): string {
  const cleaned = slug.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (cleaned.length === 0) return 'tenant'
  return cleaned.slice(0, 8)
}

/**
 * Inner pure function — exposed for tests.
 */
export function mintMerchantTransactionIdPure(
  tenantSlug: string,
  nowMs: number,
  random: Uint8Array,
): string {
  if (random.length < 8) {
    throw new RangeError(`random must be >= 8 bytes; received ${random.length}`)
  }
  const time = toBase36Padded(nowMs, 8)
  const tenant = tenantSlugSegment(tenantSlug)
  const rand = Array.from(random.slice(0, 8))
    .map((b) => byteToB36Char(b))
    .join('')
  return `TXN-${time}-${tenant}-${rand}`
}

/**
 * Production wrapper — sources `now` + `random` from runtime.
 * Returns a string guaranteed to satisfy §11.4 constraints
 * (globally unique per merchant, ≥10 chars).
 */
export function mintMerchantTransactionId(tenantSlug: string): string {
  return mintMerchantTransactionIdPure(tenantSlug, Date.now(), randomBytes(8))
}

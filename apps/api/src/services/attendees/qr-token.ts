/**
 * QR token mint helper — Sprint 3 Day 28 Phase 1.
 *
 * Generates the cryptographically-random opaque token stored in
 * `attendees.qr_code` and encoded inside the QR image that prints
 * on each ticket PDF + scans at check-in.
 *
 * ════════════════════════════════════════════════════════════════════
 * SECURITY MODEL — read this before touching the function below.
 * ════════════════════════════════════════════════════════════════════
 *
 * The QR is the AUTHORISATION ARTIFACT at check-in. Whoever holds
 * a valid token gets through the door. Therefore the token MUST
 * satisfy two properties:
 *
 *   1. **Unguessable.** An attacker who knows the URL scheme cannot
 *      brute-force a valid token in any realistic time window.
 *   2. **Unique.** Two attendees never share a token (the DB UNIQUE
 *      constraint backstops this; the mint provides the practical
 *      guarantee).
 *
 * **Mint scheme: 32 random bytes from `crypto.randomBytes` →
 * base64url-encoded (43 chars, no padding).** This yields 256 bits
 * of entropy. Brute-force at 1 billion attempts/second would still
 * take ~3.7 × 10^60 years to enumerate the keyspace; the practical
 * forge surface is zero.
 *
 * **Why opaque random (not a signed token):**
 *
 *   - **Revocability.** Voiding an attendee = delete/null the row;
 *     the token becomes invalid the moment the DB row is gone. A
 *     signed token (JWT-shape) would need a blocklist to revoke.
 *   - **No shared secret.** A signing-key compromise = mass forgery
 *     across every ticket ever issued. An opaque-random scheme has
 *     no key to compromise; an attacker would need to read the DB,
 *     at which point they already have the tokens.
 *   - **Simpler verifier.** Check-in is a single `SELECT ... WHERE
 *     qr_code = $1 AND voided_at IS NULL` — no signature math, no
 *     key rotation, no clock-skew handling.
 *   - **§10.1 already documents** `POST /public/attendees/checkin`
 *     as the scanner endpoint pattern — DB lookup is the design.
 *
 * **What the QR image encodes:** the token is intended to be wrapped
 * in a check-in URL like `${API_BASE}/scan/${token}` so the scanner
 * (Sprint 4 Day 3-4) just hits an HTTP endpoint. The URL-wrapping
 * happens at the PDF render layer (Phase 2), not here. This module
 * mints the raw token only.
 *
 * **Pure function:** takes (randomBytes) so it's deterministic for
 * tests; `mintQrToken()` is the narrow production wrapper that
 * sources entropy from `crypto.randomBytes`.
 *
 * ════════════════════════════════════════════════════════════════════
 * Mirrors the `mintMerchantTransactionId` pattern from
 * services/orders/order-id.ts (same shape: pure inner + production
 * wrapper) so the codebase has ONE way to mint opaque identifiers.
 * The mints differ in entropy size (8 bytes for txn id, 32 bytes for
 * QR token) because the threat models differ — a txn id needs only
 * to be UNIQUE under DB constraint; a QR token needs to be
 * UNGUESSABLE under brute-force attack.
 * ════════════════════════════════════════════════════════════════════
 */

import { randomBytes } from 'node:crypto'

const TOKEN_BYTES = 32 // 256 bits of entropy

/**
 * Encode raw bytes to base64url (no padding) — the URL-safe variant
 * of base64. 43 chars from 32 bytes.
 */
function bytesToBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/**
 * Inner pure function — exposed for tests so they can inject
 * deterministic bytes.
 */
export function mintQrTokenPure(random: Uint8Array): string {
  if (random.length < TOKEN_BYTES) {
    throw new RangeError(`random must be >= ${TOKEN_BYTES} bytes; received ${random.length}`)
  }
  return bytesToBase64url(random.slice(0, TOKEN_BYTES))
}

/**
 * Production wrapper — sources `random` from runtime crypto.
 * Returns a 43-char base64url string carrying 256 bits of entropy.
 *
 * The DB UNIQUE constraint on `attendees.qr_code` backstops
 * uniqueness; the practical collision probability at 256 bits is
 * vanishingly small (birthday paradox: ~10^38 tokens before
 * collision becomes likely).
 */
export function mintQrToken(): string {
  return mintQrTokenPure(randomBytes(TOKEN_BYTES))
}

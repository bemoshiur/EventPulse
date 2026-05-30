/**
 * BDT-decimal-string ↔ paisa bigint conversions, bit-exact, IEEE-754-free.
 *
 * EPS V4 (sandbox) Verify returns `TotalAmount` as a BDT decimal **string**
 * (e.g. `"1027.56"`), NEVER as a number and NEVER as paisa. We internally
 * carry paisa as `bigint` (§1.3 R2 "money never lies"). Converting via
 * `parseFloat(s) * 100` would shift money math into IEEE-754 and lose paisa
 * — `parseFloat("1027.57") * 100 === 102756.99999999999`, off by one paisa
 * on 1 BDT in 1000.
 *
 * This module does the conversion via STRING-INTEGER manipulation only.
 *
 * Grammar accepted by {@link parseBdtDecimalToPaisa}:
 *   - whole-only:  /^\d+$/             "0", "1", "1027", "100000"
 *   - two-decimal: /^\d+\.\d{2}$/      "0.00", "1.00", "1027.56"
 *
 * Anything else throws — including one-decimal `"1027.5"`, three-decimal
 * `"1027.567"`, signed `"-1.00"`, leading-dot `".50"`, trailing-dot `"1027."`,
 * exponential `"1e3"`, whitespace. EPS V4's documented shape always emits
 * either whole or 2-decimal; a divergence is itself worth flagging.
 */

/** Single regex pinning the grammar above. */
const BDT_DECIMAL_RE = /^\d+(\.\d{2})?$/

/**
 * Parse a BDT decimal string (e.g. `"1027.56"`) into paisa bigint
 * (`102756n`). Throws on any input that does not match the documented EPS V4
 * decimal grammar — including one-decimal and three-decimal strings, signed
 * values, exponent notation, and whitespace.
 */
export function parseBdtDecimalToPaisa(input: string): bigint {
  if (typeof input !== 'string') {
    throw new TypeError(`parseBdtDecimalToPaisa: expected string, received ${typeof input}`)
  }
  if (!BDT_DECIMAL_RE.test(input)) {
    throw new RangeError(
      `parseBdtDecimalToPaisa: '${input}' is not a valid BDT decimal (expected /^\\d+(\\.\\d{2})?$/)`,
    )
  }
  const dotIdx = input.indexOf('.')
  if (dotIdx === -1) {
    // whole-only: "1027" → 102700n
    return BigInt(input) * 100n
  }
  // two-decimal: "1027.56" → 1027 * 100 + 56 = 102756n
  const whole = input.slice(0, dotIdx)
  const decimal = input.slice(dotIdx + 1)
  return BigInt(whole) * 100n + BigInt(decimal)
}

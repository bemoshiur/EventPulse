/**
 * Currency helpers for BDT.
 *
 * R2 (CLAUDE.md §1.3): all amounts are stored as bigint paisa, never float.
 * 1 BDT = 100 paisa. These helpers are the only sanctioned converters between
 * paisa storage and the BDT display layer.
 *
 * Fee math itself does NOT live here — see apps/api/src/domain/payments/fee-calculator.ts.
 */

export const PAISA_PER_BDT = 100n

export type Paisa = bigint

const bdtFormatter = new Intl.NumberFormat('en-BD', {
  style: 'currency',
  currency: 'BDT',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const bdtFormatterNoSymbol = new Intl.NumberFormat('en-BD', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Convert a paisa amount to a BDT number for display. Precision-safe up to ~9 quadrillion paisa. */
export function paisaToBdt(paisa: Paisa): number {
  const whole = paisa / PAISA_PER_BDT
  const remainder = paisa % PAISA_PER_BDT
  return Number(whole) + Number(remainder) / 100
}

/**
 * Convert a BDT decimal (string or number) to paisa bigint.
 * Strings are preferred for user input to avoid float artefacts. Numbers are
 * accepted for ergonomics but rejected when not finite or not 2-decimal-clean.
 */
export function bdtToPaisa(bdt: string | number): Paisa {
  const str = typeof bdt === 'number' ? bdt.toString() : bdt.trim()
  if (!/^-?\d+(\.\d{1,2})?$/.test(str)) {
    throw new RangeError(`bdtToPaisa: not a valid BDT amount: ${str}`)
  }
  const [whole, fraction = ''] = str.split('.')
  const paddedFraction = (fraction + '00').slice(0, 2)
  const sign = whole!.startsWith('-') ? -1n : 1n
  const absWhole = whole!.replace('-', '')
  return sign * (BigInt(absWhole) * PAISA_PER_BDT + BigInt(paddedFraction))
}

/** Format paisa as "BDT 1,000.00". */
export function formatBdt(paisa: Paisa): string {
  return bdtFormatter.format(paisaToBdt(paisa))
}

/** Format paisa as "1,000.00" without the currency symbol — for tables and tight UIs. */
export function formatBdtNumber(paisa: Paisa): string {
  return bdtFormatterNoSymbol.format(paisaToBdt(paisa))
}

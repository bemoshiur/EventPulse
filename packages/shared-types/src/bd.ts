/**
 * Bangladesh-specific shared constants.
 *
 * Per §3.2: shared types/constants used by both apps/web and apps/api
 * live in this package. The BD division enum is the first cross-package
 * shared constant; it surfaces in (a) KYC address forms (Sprint 2 Day 16
 * Item 12), (b) tenant profile editing (Sprint 3+), and (c) event venue
 * forms (Sprint 3+, public landing pages). Centralising prevents the
 * "wait, is it Chittagong or Chattogram?" question from arising in
 * each new surface.
 *
 * Spellings locked to post-2018 official forms (Bangladesh renamed two
 * divisions: Chittagong → Chattogram in 2018, Barisal → Barishal in 2018).
 *
 * Decision: .claude/memory/decisions.md 2026-05-18
 *           "Per-tier KYC schemas are discriminated unions … BD division
 *           enum locked to post-2018 official spellings."
 */

export const BD_DIVISIONS = [
  'dhaka',
  'chattogram',
  'khulna',
  'rajshahi',
  'sylhet',
  'barishal',
  'rangpur',
  'mymensingh',
] as const

export type BdDivision = (typeof BD_DIVISIONS)[number]

/**
 * Bangla labels for the canonical eight divisions, keyed by the lowercase
 * enum value. Frontend select components render `BD_DIVISION_LABELS_BN[value]`
 * alongside the English label per §19's bilingual surface convention.
 * The schema itself stays English-keyed; this map is purely for display.
 */
export const BD_DIVISION_LABELS_BN: Record<BdDivision, string> = {
  dhaka: 'ঢাকা',
  chattogram: 'চট্টগ্রাম',
  khulna: 'খুলনা',
  rajshahi: 'রাজশাহী',
  sylhet: 'সিলেট',
  barishal: 'বরিশাল',
  rangpur: 'রংপুর',
  mymensingh: 'ময়মনসিংহ',
}

/**
 * English labels for the same divisions. Frontend uses these for the
 * primary select option label.
 */
export const BD_DIVISION_LABELS_EN: Record<BdDivision, string> = {
  dhaka: 'Dhaka',
  chattogram: 'Chattogram',
  khulna: 'Khulna',
  rajshahi: 'Rajshahi',
  sylhet: 'Sylhet',
  barishal: 'Barishal',
  rangpur: 'Rangpur',
  mymensingh: 'Mymensingh',
}

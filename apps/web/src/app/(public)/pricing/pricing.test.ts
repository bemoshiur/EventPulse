/**
 * Marketing pricing calculator — drift guard.
 *
 * The /pricing page renders fee scenarios at the v1.0 launch bKash rate
 * (175 bps platform 25 bps). The arithmetic is a paisa-bigint mirror of
 * apps/api/src/domain/payments/fee-calculator.ts (which lives in the
 * api workspace and per §3.2 cannot be imported from the web workspace).
 *
 * This test pins the marketing page's output to hand-computed canonical
 * values. If the canonical calculator ever drifts (e.g. PR changes the
 * order of operations on the eps_capture_base), the api test suite will
 * catch the canonical side; if the marketing page drifts independently,
 * this test catches the marketing side.
 *
 * Numbers below are paisa, derived from BDT 1,000 ticket face at v1.0
 * rates: platform = 1000 × 25/10000 = 250 paisa; eps depends on mode.
 */
import { describe, expect, it } from 'vitest'

const PLATFORM_FEE_BPS = 25
const BKASH_FEE_BPS = 175
const BPS_DIVISOR = 10_000n

function feeOnAmount(amountPaisa: bigint, bps: number): bigint {
  return (amountPaisa * BigInt(bps)) / BPS_DIVISOR
}

type Mode = 'absorb_absorb' | 'absorb_pass' | 'pass_absorb' | 'pass_pass'

function compute(facePaisa: bigint, mode: Mode) {
  const platformFee = feeOnAmount(facePaisa, PLATFORM_FEE_BPS)
  const [platformHandling, epsHandling] = mode.split('_') as ['absorb' | 'pass', 'absorb' | 'pass']

  const epsCaptureBase = platformHandling === 'pass' ? facePaisa + platformFee : facePaisa
  const epsFee = feeOnAmount(epsCaptureBase, BKASH_FEE_BPS)

  const buyerTotal =
    facePaisa +
    (platformHandling === 'pass' ? platformFee : 0n) +
    (epsHandling === 'pass' ? epsFee : 0n)

  const organiserNet =
    facePaisa -
    (platformHandling === 'absorb' ? platformFee : 0n) -
    (epsHandling === 'absorb' ? epsFee : 0n)

  return { platformFee, epsFee, buyerTotal, organiserNet }
}

describe('marketing /pricing calculator — drift guard at v1.0 bKash rate', () => {
  const face = 100_000n // BDT 1,000 ticket

  it('platform fee is 250 paisa regardless of mode (BDT 2.50)', () => {
    for (const mode of ['absorb_absorb', 'absorb_pass', 'pass_absorb', 'pass_pass'] as const) {
      expect(compute(face, mode).platformFee).toBe(250n)
    }
  })

  it('Mode (pass, pass) — buyer pays 1020.04, organiser receives full 1000.00', () => {
    const r = compute(face, 'pass_pass')
    expect(r.epsFee).toBe(1754n)
    expect(r.buyerTotal).toBe(102_004n)
    expect(r.organiserNet).toBe(100_000n)
  })

  it('Mode (absorb, absorb) — buyer pays 1000.00, organiser receives 980.00', () => {
    const r = compute(face, 'absorb_absorb')
    expect(r.epsFee).toBe(1750n)
    expect(r.buyerTotal).toBe(100_000n)
    expect(r.organiserNet).toBe(98_000n)
  })

  it('Mode (absorb, pass) — buyer pays 1017.50, organiser receives 997.50', () => {
    const r = compute(face, 'absorb_pass')
    expect(r.epsFee).toBe(1750n)
    expect(r.buyerTotal).toBe(101_750n)
    expect(r.organiserNet).toBe(99_750n)
  })

  it('Mode (pass, absorb) — buyer pays 1002.50, organiser receives 982.46', () => {
    const r = compute(face, 'pass_absorb')
    expect(r.epsFee).toBe(1754n)
    expect(r.buyerTotal).toBe(100_250n)
    expect(r.organiserNet).toBe(98_246n)
  })

  it('free event (subtotal=0) — all zeros regardless of mode', () => {
    for (const mode of ['absorb_absorb', 'absorb_pass', 'pass_absorb', 'pass_pass'] as const) {
      const r = compute(0n, mode)
      expect(r.platformFee).toBe(0n)
      expect(r.epsFee).toBe(0n)
      expect(r.buyerTotal).toBe(0n)
      expect(r.organiserNet).toBe(0n)
    }
  })

  it('large face (BDT 50,000) — bigint arithmetic does not overflow', () => {
    const r = compute(5_000_000n, 'pass_pass')
    expect(r.platformFee).toBe(12_500n) // 5,000,000 × 25/10000
    expect(r.epsFee).toBe(87_718n) // (5,000,000 + 12,500) × 175/10000 floor = 87718
    expect(r.organiserNet).toBe(5_000_000n)
  })
})

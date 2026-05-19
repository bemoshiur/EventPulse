/**
 * Fee calculator — unit tests per §14.3.
 *
 * Covers the four §14.2 worked examples (Mode A/B/C/D, BDT 1,000 face value,
 * 0.25% platform, 2.5% EPS) PLUS edge cases (free event, 1-paisa, large
 * subtotal, per-tenant override, invalid inputs, determinism).
 *
 * No DB, no fixture setup, no jose, no S3 — pure-function unit tests.
 * Tests run in node-default vitest config (apps/api/vitest.config.ts root).
 */

import { describe, expect, it } from 'vitest'
import {
  calculateFees,
  calculateOrderFees,
  type FeeCalcInput,
  InvalidFeeCalcInputError,
} from './fee-calculator.js'

// ─── helpers ───────────────────────────────────────────────────────────

/** BDT face value 1,000.00 = 100_000 paisa. The §14.2 worked-example anchor. */
const ONE_THOUSAND_BDT_PAISA = 100_000n
/** Platform fee default per §14: 0.25% = 25 bps. */
const PLATFORM_BPS_25 = 25
/** EPS fee illustrative per §14.2: 2.5% = 250 bps. */
const EPS_BPS_250 = 250

function makeInput(overrides: Partial<FeeCalcInput> = {}): FeeCalcInput {
  return {
    ticketSubtotalPaisa: ONE_THOUSAND_BDT_PAISA,
    platformFeeBps: PLATFORM_BPS_25,
    epsFeeBps: EPS_BPS_250,
    platformFeeHandling: 'pass_through',
    epsFeeHandling: 'pass_through',
    ...overrides,
  }
}

// ─── §14.2 worked examples ─────────────────────────────────────────────

describe('§14.2 worked example — Mode A (both pass_through)', () => {
  it('subtotal 1,000.00 + 0.25% platform + 2.5% eps → buyer 1,027.56, organiser 1,000.00', () => {
    const result = calculateOrderFees(
      makeInput({
        platformFeeHandling: 'pass_through',
        epsFeeHandling: 'pass_through',
      }),
    )

    // §14.2 Mode A line items:
    //   Ticket             1,000.00       = 100_000 paisa
    //   Platform fee           2.50       = 250 paisa
    //   Payment fee           25.06       = 2506 paisa (floor of 2506.25)
    //   Total              1,027.56       = 102_756 paisa
    // Organiser receives 1,000.00.
    expect(result.subtotalPaisa).toBe(100_000n)
    expect(result.platformFeePaisa).toBe(250n)
    expect(result.epsFeePaisa).toBe(2506n)
    expect(result.buyerTotalPaisa).toBe(102_756n)
    expect(result.organiserNetPaisa).toBe(100_000n)
    expect(result.platformRevenuePaisa).toBe(250n)
    expect(result.breakdown).toEqual([
      { label: 'ticket_subtotal', amountPaisa: 100_000n },
      { label: 'platform_fee', amountPaisa: 250n },
      { label: 'eps_fee', amountPaisa: 2506n },
    ])
  })
})

describe('§14.2 worked example — Mode B (both absorb)', () => {
  it('subtotal 1,000.00 + 0.25% platform + 2.5% eps → buyer 1,000.00, organiser 972.50', () => {
    const result = calculateOrderFees(
      makeInput({
        platformFeeHandling: 'absorb',
        epsFeeHandling: 'absorb',
      }),
    )

    // §14.2 Mode B line items:
    //   Buyer Total        1,000.00       = 100_000 paisa
    //   EPS keeps 25.00 (2.5% of 1,000)   = 2500 paisa
    //   Platform fee on face value 2.50   = 250 paisa
    //   Organiser receives 972.50         = 97_250 paisa
    expect(result.subtotalPaisa).toBe(100_000n)
    expect(result.platformFeePaisa).toBe(250n)
    expect(result.epsFeePaisa).toBe(2500n)
    expect(result.buyerTotalPaisa).toBe(100_000n)
    expect(result.organiserNetPaisa).toBe(97_250n)
    expect(result.platformRevenuePaisa).toBe(250n)
    // No pass-through fees → breakdown is ticket only.
    expect(result.breakdown).toEqual([{ label: 'ticket_subtotal', amountPaisa: 100_000n }])
  })
})

describe('§14.2 worked example — Mode C (platform absorb, eps pass_through)', () => {
  it('subtotal 1,000.00 + 0.25% platform + 2.5% eps → buyer 1,025.00, organiser 997.50', () => {
    const result = calculateOrderFees(
      makeInput({
        platformFeeHandling: 'absorb',
        epsFeeHandling: 'pass_through',
      }),
    )

    // §14.2 Mode C line items (taking the "or 25.00" simpler-math branch):
    //   Ticket             1,000.00       = 100_000 paisa
    //   Payment fee           25.00       = 2500 paisa (2.5% × 1,000 — eps base = subtotal since platform absorbed)
    //   Total              1,025.00       = 102_500 paisa
    //   Platform fee on face value 2.50   = 250 paisa (absorbed by organiser)
    //   Organiser receives 997.50         = 99_750 paisa
    expect(result.subtotalPaisa).toBe(100_000n)
    expect(result.platformFeePaisa).toBe(250n)
    expect(result.epsFeePaisa).toBe(2500n)
    expect(result.buyerTotalPaisa).toBe(102_500n)
    expect(result.organiserNetPaisa).toBe(99_750n)
    expect(result.platformRevenuePaisa).toBe(250n)
    expect(result.breakdown).toEqual([
      { label: 'ticket_subtotal', amountPaisa: 100_000n },
      { label: 'eps_fee', amountPaisa: 2500n },
    ])
  })
})

describe('§14.2 worked example — Mode D (platform pass_through, eps absorb)', () => {
  it('subtotal 1,000.00 + 0.25% platform + 2.5% eps → buyer 1,002.50, organiser 974.94 (EPS fee on larger captured amount)', () => {
    const result = calculateOrderFees(
      makeInput({
        platformFeeHandling: 'pass_through',
        epsFeeHandling: 'absorb',
      }),
    )

    // §14.2 Mode D line items:
    //   Ticket             1,000.00       = 100_000 paisa
    //   Platform fee           2.50       = 250 paisa
    //   Buyer Total        1,002.50       = 100_250 paisa
    //   EPS captures 1,002.50; charges 2.5% on capture = 25.0625 BDT (floor 2506 paisa) — absorbed by organiser
    //   Organiser receives 974.94         = 97_494 paisa (100_000 - 2506 EPS - 0 platform)
    // The "EPS fee on the larger captured amount" §14.2 footnote is the
    // load-bearing test point here.
    expect(result.subtotalPaisa).toBe(100_000n)
    expect(result.platformFeePaisa).toBe(250n)
    expect(result.epsFeePaisa).toBe(2506n)
    expect(result.buyerTotalPaisa).toBe(100_250n)
    expect(result.organiserNetPaisa).toBe(97_494n)
    expect(result.platformRevenuePaisa).toBe(250n)
    expect(result.breakdown).toEqual([
      { label: 'ticket_subtotal', amountPaisa: 100_000n },
      { label: 'platform_fee', amountPaisa: 250n },
    ])
  })
})

// ─── Edge cases ────────────────────────────────────────────────────────

describe('Free event (subtotal = 0)', () => {
  // §13.5 specifies that the fee calculator is called regardless of
  // whether an event is free; the calculator returns all-zeros for
  // subtotal=0 and downstream code never branches on "is this free?"
  it.each([
    { p: 'pass_through' as const, e: 'pass_through' as const },
    { p: 'absorb' as const, e: 'absorb' as const },
    { p: 'absorb' as const, e: 'pass_through' as const },
    { p: 'pass_through' as const, e: 'absorb' as const },
  ])('returns all-zeros for every handling combination (platform=$p, eps=$e)', ({ p, e }) => {
    const result = calculateOrderFees(
      makeInput({
        ticketSubtotalPaisa: 0n,
        platformFeeHandling: p,
        epsFeeHandling: e,
      }),
    )
    expect(result.subtotalPaisa).toBe(0n)
    expect(result.platformFeePaisa).toBe(0n)
    expect(result.epsFeePaisa).toBe(0n)
    expect(result.buyerTotalPaisa).toBe(0n)
    expect(result.organiserNetPaisa).toBe(0n)
    expect(result.platformRevenuePaisa).toBe(0n)
    expect(result.breakdown).toEqual([{ label: 'ticket_subtotal', amountPaisa: 0n }])
  })
})

describe('Coupon-zeroed subtotal — semantically distinct from free event but identical math', () => {
  it('still returns all-zeros (the calculator is single source of truth regardless of upstream origin)', () => {
    const result = calculateOrderFees(makeInput({ ticketSubtotalPaisa: 0n }))
    expect(result.platformRevenuePaisa).toBe(0n)
    expect(result.organiserNetPaisa).toBe(0n)
  })
})

describe('1-paisa subtotal — bps × tiny amounts floor to zero', () => {
  it('1 paisa × 25 bps / 10000 = 0 paisa (no fractional paisa)', () => {
    const result = calculateOrderFees(makeInput({ ticketSubtotalPaisa: 1n }))
    expect(result.subtotalPaisa).toBe(1n)
    expect(result.platformFeePaisa).toBe(0n) // 1 × 25 / 10000 = 0
    expect(result.epsFeePaisa).toBe(0n) // (1 + 0) × 250 / 10000 = 0
    expect(result.buyerTotalPaisa).toBe(1n)
    expect(result.organiserNetPaisa).toBe(1n)
  })

  it('400 paisa × 25 bps = 1 paisa platform fee (first paisa appears here)', () => {
    // 400 × 25 / 10000 = 1
    const result = calculateOrderFees(makeInput({ ticketSubtotalPaisa: 400n }))
    expect(result.platformFeePaisa).toBe(1n)
  })

  it('399 paisa × 25 bps = 0 paisa platform fee (just below the first paisa)', () => {
    // 399 × 25 / 10000 = 0 (truncate of 0.9975)
    const result = calculateOrderFees(makeInput({ ticketSubtotalPaisa: 399n }))
    expect(result.platformFeePaisa).toBe(0n)
  })
})

describe('Very large subtotal — bigint arithmetic does not overflow', () => {
  it('handles BDT 1,000,000.00 (= 100_000_000 paisa, a single very large order)', () => {
    const result = calculateOrderFees(makeInput({ ticketSubtotalPaisa: 100_000_000n }))
    expect(result.platformFeePaisa).toBe(250_000n) // 100_000_000 × 25 / 10000
    expect(result.epsFeePaisa).toBe(2_506_250n) // (100_000_000 + 250_000) × 250 / 10000
    expect(result.buyerTotalPaisa).toBe(102_756_250n)
    expect(result.organiserNetPaisa).toBe(100_000_000n) // Mode A — organiser net = subtotal
  })

  it('handles BDT 1,000,000,000.00 in a single payment (= 100 billion paisa)', () => {
    // 100_000_000_000n paisa = BDT 1 billion. Sanity check that bigint
    // multiplication × bps doesn't surface any platform-dependent edge.
    const huge = 100_000_000_000n
    const result = calculateOrderFees(makeInput({ ticketSubtotalPaisa: huge }))
    expect(result.platformFeePaisa).toBe(250_000_000n) // 0.25% of 100B
    expect(result.organiserNetPaisa).toBe(huge) // Mode A — organiser net = subtotal
  })
})

describe('Per-tenant override platform_fee_bps — §14.4 super-admin-adjusted rate', () => {
  it('honours platform_fee_bps = 50 (super admin doubled fee to 0.50%) end-to-end', () => {
    const result = calculateOrderFees(
      makeInput({
        platformFeeBps: 50, // doubled from 25
        platformFeeHandling: 'pass_through',
        epsFeeHandling: 'pass_through',
      }),
    )
    expect(result.platformFeePaisa).toBe(500n) // 100_000 × 50 / 10000
    expect(result.platformRevenuePaisa).toBe(500n)
    // Buyer pays subtotal + new-rate platform_fee + eps_fee-on-larger-capture
    // eps_fee = (100_000 + 500) × 250 / 10000 = 2512.5 → 2512 paisa
    expect(result.epsFeePaisa).toBe(2512n)
    expect(result.buyerTotalPaisa).toBe(100_000n + 500n + 2512n)
  })

  it('honours platform_fee_bps = 0 (custom enterprise arrangement — no platform fee)', () => {
    const result = calculateOrderFees(makeInput({ platformFeeBps: 0 }))
    expect(result.platformFeePaisa).toBe(0n)
    expect(result.platformRevenuePaisa).toBe(0n)
    expect(result.organiserNetPaisa).toBe(100_000n) // Mode A defaults — organiser gets full subtotal
  })

  it('honours platform_fee_bps = 25 default + eps_fee_bps = 0 (bank-direct payment method with no gateway fee)', () => {
    const result = calculateOrderFees(makeInput({ epsFeeBps: 0 }))
    expect(result.epsFeePaisa).toBe(0n)
    expect(result.buyerTotalPaisa).toBe(100_250n) // subtotal + platform_fee only
  })
})

describe('Determinism — same input → bit-identical output across repeated calls', () => {
  // §14.3 requires the function to be deterministic. Anything non-deterministic
  // (Date.now, random, fetch) would break this guarantee.
  it('returns equal results from two successive calls with identical input', () => {
    const input = makeInput()
    const a = calculateOrderFees(input)
    const b = calculateOrderFees(input)
    expect(a).toEqual(b)
  })

  it('does NOT mutate the input object', () => {
    const input = makeInput()
    const snapshot = { ...input }
    calculateOrderFees(input)
    expect(input).toEqual(snapshot)
  })
})

describe('§14.3 alias — calculateFees points at the same implementation', () => {
  it('calculateFees and calculateOrderFees produce equal output', () => {
    const input = makeInput()
    expect(calculateFees(input)).toEqual(calculateOrderFees(input))
  })
})

// ─── Invalid input rejection ───────────────────────────────────────────

describe('Invalid input — calculator throws rather than silently producing wrong numbers', () => {
  it('rejects non-bigint ticketSubtotalPaisa', () => {
    // @ts-expect-error — intentional runtime check, types reject at compile time
    expect(() => calculateOrderFees(makeInput({ ticketSubtotalPaisa: 100_000 }))).toThrow(
      InvalidFeeCalcInputError,
    )
  })

  it('rejects negative ticketSubtotalPaisa', () => {
    expect(() => calculateOrderFees(makeInput({ ticketSubtotalPaisa: -1n }))).toThrow(
      /ticketSubtotalPaisa must be >= 0/,
    )
  })

  it('rejects non-integer platformFeeBps', () => {
    expect(() => calculateOrderFees(makeInput({ platformFeeBps: 25.5 }))).toThrow(
      /platformFeeBps must be an integer/,
    )
  })

  it('rejects negative platformFeeBps', () => {
    expect(() => calculateOrderFees(makeInput({ platformFeeBps: -1 }))).toThrow(
      /platformFeeBps must be >= 0/,
    )
  })

  it('rejects platformFeeBps > 10000 (above 100%)', () => {
    expect(() => calculateOrderFees(makeInput({ platformFeeBps: 10_001 }))).toThrow(
      /platformFeeBps must be <= 10000/,
    )
  })

  it('rejects non-integer epsFeeBps', () => {
    expect(() => calculateOrderFees(makeInput({ epsFeeBps: 250.5 }))).toThrow(
      /epsFeeBps must be an integer/,
    )
  })

  it('rejects negative epsFeeBps', () => {
    expect(() => calculateOrderFees(makeInput({ epsFeeBps: -1 }))).toThrow(/epsFeeBps must be >= 0/)
  })

  it('rejects epsFeeBps > 10000', () => {
    expect(() => calculateOrderFees(makeInput({ epsFeeBps: 10_001 }))).toThrow(
      /epsFeeBps must be <= 10000/,
    )
  })

  it('rejects unsupported platformFeeHandling literal', () => {
    expect(() =>
      // @ts-expect-error — intentional runtime check
      calculateOrderFees(makeInput({ platformFeeHandling: 'magic' })),
    ).toThrow(/platformFeeHandling must be 'absorb' \| 'pass_through'/)
  })

  it('rejects unsupported epsFeeHandling literal', () => {
    expect(() =>
      // @ts-expect-error — intentional runtime check
      calculateOrderFees(makeInput({ epsFeeHandling: 'free' })),
    ).toThrow(/epsFeeHandling must be 'absorb' \| 'pass_through'/)
  })

  it('rejects NaN bps', () => {
    expect(() => calculateOrderFees(makeInput({ platformFeeBps: NaN }))).toThrow(
      InvalidFeeCalcInputError,
    )
  })

  it('rejects Infinity bps', () => {
    expect(() =>
      calculateOrderFees(makeInput({ platformFeeBps: Number.POSITIVE_INFINITY })),
    ).toThrow(InvalidFeeCalcInputError)
  })
})

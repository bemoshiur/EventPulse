/**
 * §14.10 ledger invariants — pure unit tests.
 *
 * Sprint 3 Day 30 Phase 2.
 *
 * Pinned behaviour:
 *
 *   1. Invariant 1 holds for every §14.2 fee-calculator output mode
 *      BY CONSTRUCTION — the calculator's outputs always sum correctly.
 *      Test exercises all 4 modes × a range of subtotals + bps.
 *   2. Empty input → empty violations (vacuously true).
 *   3. Synthetic violation rows → detected; correct diff sign.
 *   4. The convenience `assertInvariant1PerOrder` throws on violation
 *      and carries the full violation list on the typed error.
 *   5. Invariant 2 holds for fixture batch rows (no real batches exist
 *      in Sprint 3; the test uses synthetic data to prove the
 *      verifier surface works).
 *   6. Bit-exact bigint arithmetic — single-paisa discrepancy is
 *      detected; no tolerance.
 *
 * The DB-backed verifier (asserting Invariant 1 across ALL orders in
 * the test DB) is exercised in apps/api/src/routes/public/orders-e2e-smoke.test.ts
 * which is DB-gated.
 */

import { describe, expect, it } from 'vitest'

import {
  assertInvariant1PerOrder,
  assertInvariant2PerBatch,
  checkInvariant1PerOrder,
  checkInvariant2PerBatch,
  LedgerInvariantError,
  type LedgerBatchRow,
  type LedgerOrderRow,
} from './invariants.js'

import { calculateOrderFees, type FeeCalcInput } from '../payments/fee-calculator.js'

// ─── helper: build a LedgerOrderRow from calculator output ──────────

function rowFromCalc(id: string, input: FeeCalcInput): LedgerOrderRow {
  const calc = calculateOrderFees(input)
  return {
    id,
    totalPaisa: calc.buyerTotalPaisa,
    netToOrganiserPaisa: calc.organiserNetPaisa,
    platformFeePaisa: calc.platformFeePaisa,
    epsFeePaisa: calc.epsFeePaisa,
    // §14.3 calculator is pre-withholding (per its file header + §29 #9
    // pending); withholding stays 0 on every order until the AIT
    // classification lands. The Invariant-1 expression includes it
    // explicitly so a future withholding row addition is checked.
    withholdingTaxPaisa: 0n,
  }
}

describe('checkInvariant1PerOrder — empty + violation paths', () => {
  it('empty input → empty violations', () => {
    expect(checkInvariant1PerOrder([])).toEqual([])
  })

  it('synthetic OVER-stated total → detected; diff is negative (expected − actual < 0)', () => {
    // Total over-states the split by 1 paisa → expected = split,
    // actual = total, diff = expected - actual = -1.
    const rows: LedgerOrderRow[] = [
      {
        id: 'order-over',
        totalPaisa: 1001n,
        netToOrganiserPaisa: 1000n,
        platformFeePaisa: 0n,
        epsFeePaisa: 0n,
        withholdingTaxPaisa: 0n,
      },
    ]
    const violations = checkInvariant1PerOrder(rows)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.invariant).toBe('invariant_1_per_order_money_split')
    expect(violations[0]!.rowId).toBe('order-over')
    expect(violations[0]!.expected).toBe(1000n)
    expect(violations[0]!.actual).toBe(1001n)
    expect(violations[0]!.diff).toBe(-1n)
  })

  it('synthetic UNDER-stated total → detected; diff is positive (expected − actual > 0)', () => {
    const rows: LedgerOrderRow[] = [
      {
        id: 'order-under',
        totalPaisa: 999n,
        netToOrganiserPaisa: 800n,
        platformFeePaisa: 100n,
        epsFeePaisa: 100n,
        withholdingTaxPaisa: 0n,
      },
    ]
    const violations = checkInvariant1PerOrder(rows)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.diff).toBe(1n)
  })

  it('mixed valid + violating rows → only the violator surfaces', () => {
    const rows: LedgerOrderRow[] = [
      {
        id: 'order-ok',
        totalPaisa: 0n,
        netToOrganiserPaisa: 0n,
        platformFeePaisa: 0n,
        epsFeePaisa: 0n,
        withholdingTaxPaisa: 0n,
      },
      {
        id: 'order-bad',
        totalPaisa: 100n,
        netToOrganiserPaisa: 50n,
        platformFeePaisa: 0n,
        epsFeePaisa: 0n,
        withholdingTaxPaisa: 0n,
      },
      {
        id: 'order-ok-2',
        totalPaisa: 200n,
        netToOrganiserPaisa: 100n,
        platformFeePaisa: 50n,
        epsFeePaisa: 50n,
        withholdingTaxPaisa: 0n,
      },
    ]
    const violations = checkInvariant1PerOrder(rows)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.rowId).toBe('order-bad')
  })

  it('bit-exact: single paisa off → detected; no tolerance', () => {
    const rows: LedgerOrderRow[] = [
      {
        id: 'order-1p-off',
        totalPaisa: 100_000n,
        netToOrganiserPaisa: 99_998n, // 1 paisa short
        platformFeePaisa: 1n,
        epsFeePaisa: 0n,
        withholdingTaxPaisa: 0n,
      },
    ]
    const violations = checkInvariant1PerOrder(rows)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.diff).toBe(-1n)
  })
})

describe('checkInvariant1PerOrder — BY CONSTRUCTION via fee-calculator', () => {
  // For every §14.2 fee-handling mode + a range of subtotals + bps,
  // the calculator's output must satisfy the invariant by construction.
  // This is the load-bearing property: the calculator IS the money
  // truth (§14.3); if the calculator produces rows that violate the
  // invariant, the invariant verifier would be useless.

  const subtotals = [0n, 1n, 100n, 100_000n, 100_000_000n] // 0 paisa to BDT 1M
  const platformBpsCases = [25, 50, 100, 250]
  const epsBpsCases = [0, 150, 250, 350]
  const modes: Array<{
    platformFeeHandling: 'absorb' | 'pass_through'
    epsFeeHandling: 'absorb' | 'pass_through'
  }> = [
    { platformFeeHandling: 'pass_through', epsFeeHandling: 'pass_through' },
    { platformFeeHandling: 'absorb', epsFeeHandling: 'absorb' },
    { platformFeeHandling: 'absorb', epsFeeHandling: 'pass_through' },
    { platformFeeHandling: 'pass_through', epsFeeHandling: 'absorb' },
  ]

  for (const mode of modes) {
    for (const subtotal of subtotals) {
      for (const platformBps of platformBpsCases) {
        for (const epsBps of epsBpsCases) {
          const name = `subtotal=${subtotal}p platformBps=${platformBps} epsBps=${epsBps} platform=${mode.platformFeeHandling} eps=${mode.epsFeeHandling}`
          it(`Invariant 1 holds: ${name}`, () => {
            const row = rowFromCalc(`row-${name}`, {
              ticketSubtotalPaisa: subtotal,
              platformFeeBps: platformBps,
              epsFeeBps: epsBps,
              ...mode,
            })
            const violations = checkInvariant1PerOrder([row])
            if (violations.length > 0) {
              throw new Error(
                `Invariant 1 violated by construction: ${JSON.stringify({
                  input: { subtotal: subtotal.toString(), platformBps, epsBps, ...mode },
                  row: {
                    total: row.totalPaisa.toString(),
                    net: row.netToOrganiserPaisa.toString(),
                    platform: row.platformFeePaisa.toString(),
                    eps: row.epsFeePaisa.toString(),
                    withholding: row.withholdingTaxPaisa.toString(),
                  },
                  diff: violations[0]!.diff.toString(),
                })}`,
              )
            }
            expect(violations).toEqual([])
          })
        }
      }
    }
  }
})

describe('assertInvariant1PerOrder — throws on violation', () => {
  it('throws LedgerInvariantError with the full violation list', () => {
    const rows: LedgerOrderRow[] = [
      {
        id: 'order-bad-1',
        totalPaisa: 100n,
        netToOrganiserPaisa: 50n,
        platformFeePaisa: 0n,
        epsFeePaisa: 0n,
        withholdingTaxPaisa: 0n,
      },
      {
        id: 'order-bad-2',
        totalPaisa: 200n,
        netToOrganiserPaisa: 50n,
        platformFeePaisa: 0n,
        epsFeePaisa: 0n,
        withholdingTaxPaisa: 0n,
      },
    ]
    try {
      assertInvariant1PerOrder(rows)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(LedgerInvariantError)
      if (err instanceof LedgerInvariantError) {
        expect(err.violations).toHaveLength(2)
        expect(err.violations[0]!.rowId).toBe('order-bad-1')
        expect(err.violations[1]!.rowId).toBe('order-bad-2')
        expect(err.message).toContain('order-bad-1')
        expect(err.message).toContain('order-bad-2')
      }
    }
  })

  it('does not throw on clean input', () => {
    const rows: LedgerOrderRow[] = [
      {
        id: 'order-ok',
        totalPaisa: 100n,
        netToOrganiserPaisa: 100n,
        platformFeePaisa: 0n,
        epsFeePaisa: 0n,
        withholdingTaxPaisa: 0n,
      },
    ]
    expect(() => assertInvariant1PerOrder(rows)).not.toThrow()
  })
})

describe('checkInvariant2PerBatch — fixture-only (no batches exist in Sprint 3)', () => {
  // disbursement_batches lands Sprint 7 per §26.2. Until then, the
  // verifier is unit-tested against synthetic rows. When the schema
  // lands, the DB-backed verifier wires in at the same seam.

  it('empty input → empty violations', () => {
    expect(checkInvariant2PerBatch([])).toEqual([])
  })

  it('clean batch (gross - refunds - withholding = net) → no violations', () => {
    const rows: LedgerBatchRow[] = [
      {
        id: 'batch-1',
        grossPaisa: 100_000n,
        refundsPaisa: 5_000n,
        withholdingTaxPaisa: 1_000n,
        netPaisa: 94_000n,
      },
    ]
    expect(checkInvariant2PerBatch(rows)).toEqual([])
  })

  it('OVER-stated net (e.g. retained 1p extra) → detected', () => {
    const rows: LedgerBatchRow[] = [
      {
        id: 'batch-over',
        grossPaisa: 100_000n,
        refundsPaisa: 0n,
        withholdingTaxPaisa: 0n,
        netPaisa: 100_001n, // 1p too much
      },
    ]
    const violations = checkInvariant2PerBatch(rows)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.invariant).toBe('invariant_2_batch_reconciliation')
    expect(violations[0]!.diff).toBe(-1n)
  })

  it('UNDER-stated net (e.g. lost 1p in reconciliation) → detected', () => {
    const rows: LedgerBatchRow[] = [
      {
        id: 'batch-under',
        grossPaisa: 100_000n,
        refundsPaisa: 0n,
        withholdingTaxPaisa: 0n,
        netPaisa: 99_999n,
      },
    ]
    const violations = checkInvariant2PerBatch(rows)
    expect(violations[0]!.diff).toBe(1n)
  })

  it('assertInvariant2PerBatch throws on violation', () => {
    expect(() =>
      assertInvariant2PerBatch([
        {
          id: 'b',
          grossPaisa: 100n,
          refundsPaisa: 0n,
          withholdingTaxPaisa: 0n,
          netPaisa: 50n,
        },
      ]),
    ).toThrowError(LedgerInvariantError)
  })
})

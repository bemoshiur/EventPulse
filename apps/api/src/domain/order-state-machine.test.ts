/**
 * Order state machine — unit tests for the pure transition validator.
 *
 * Sprint 3 Day 27 Phase 1. Mirrors the test discipline of
 * event-state-machine.test.ts.
 *
 * Scope:
 *   - All 11 legal states defined per §9.5 + the live
 *     `orders_status_chk` constraint
 *   - Every legal transition passes
 *   - Every illegal transition rejected
 *   - Five terminal states (completed, cancelled, failed, refunded,
 *     reversed) reject ALL outbound transitions
 *   - Self-transitions rejected uniformly (idempotency is a
 *     service-layer concern, not a state-machine one)
 *   - `mapEpsStatusToOrderTransition` exhaustive over the 5 canonical
 *     EpsStatus values
 *
 * Pure tests — no I/O, no mocks, no time-of-day. Same inputs → same
 * outputs.
 */

import { describe, expect, it } from 'vitest'

import {
  ORDER_STATUSES,
  allowedTransitions,
  isTerminal,
  mapEpsStatusToOrderTransition,
  orderStatusSchema,
  validateTransition,
  type OrderStatus,
} from './order-state-machine.js'

// ─── canonical state list ───────────────────────────────────────────

describe('ORDER_STATUSES', () => {
  it('matches the §9.5 + live CHECK constraint 11-state enum exactly', () => {
    expect([...ORDER_STATUSES].sort()).toEqual([
      'awaiting_payment',
      'cancelled',
      'chargeback',
      'completed',
      'disputed',
      'failed',
      'paid',
      'pending',
      'refund_requested',
      'refunded',
      'reversed',
    ])
  })

  it('orderStatusSchema accepts every legal status', () => {
    for (const s of ORDER_STATUSES) {
      expect(orderStatusSchema.safeParse(s).success).toBe(true)
    }
  })

  it('orderStatusSchema rejects unknown status strings', () => {
    expect(orderStatusSchema.safeParse('expired').success).toBe(false)
    expect(orderStatusSchema.safeParse('Paid').success).toBe(false) // case-sensitive
    expect(orderStatusSchema.safeParse('').success).toBe(false)
  })
})

// ─── legal transitions — the §2.5 lifecycle ─────────────────────────

describe('legal transitions per §2.5 + §11.1', () => {
  // Each row: [from, to, allowed?]
  const cases: Array<[OrderStatus, OrderStatus]> = [
    // Pre-payment phase
    ['pending', 'awaiting_payment'],
    ['pending', 'cancelled'],
    ['pending', 'failed'],

    // Post-init verification phase (the Day 27 hot path)
    ['awaiting_payment', 'paid'],
    ['awaiting_payment', 'cancelled'],
    ['awaiting_payment', 'failed'],

    // Post-payment phase
    ['paid', 'completed'],
    ['paid', 'refund_requested'],
    ['paid', 'disputed'],

    // Refund subpath
    ['refund_requested', 'refunded'],

    // Dispute subpath
    ['disputed', 'chargeback'],
    ['chargeback', 'reversed'],
  ]

  it.each(cases)('%s → %s is legal', (from, to) => {
    const result = validateTransition(from, to)
    expect(result.valid).toBe(true)
    expect(result.allowedNext).toContain(to)
  })
})

// ─── illegal transitions — load-bearing fraud-prevention cases ──────

describe('illegal transitions (the fraud-prevention surface)', () => {
  // The most important rejections — keep these as a fixed list so a
  // future refactor can't relax them without explicitly editing this
  // test file (which surfaces in PR review).
  const illegalLoadBearing: Array<[OrderStatus, OrderStatus]> = [
    // Rewinds — would allow re-charging or unfunded settlement
    ['paid', 'awaiting_payment'],
    ['paid', 'pending'],
    ['awaiting_payment', 'pending'],

    // Skips — bypass the EPS verification step
    ['pending', 'paid'],
    ['pending', 'completed'],
    ['awaiting_payment', 'completed'],

    // Resurrection — would bypass re-creation flow
    ['cancelled', 'paid'],
    ['failed', 'paid'],
    ['cancelled', 'awaiting_payment'],
    ['failed', 'awaiting_payment'],

    // Cross-branch jumps
    ['refunded', 'disputed'],
    ['chargeback', 'refunded'],
    ['completed', 'refund_requested'], // refund post-completion deliberately NOT allowed at this layer
    ['completed', 'disputed'],
  ]

  it.each(illegalLoadBearing)('%s → %s is rejected', (from, to) => {
    const result = validateTransition(from, to)
    expect(result.valid).toBe(false)
    expect(result.reason).toBeDefined()
    expect(result.reason).toContain(from)
  })
})

// ─── self-transitions (idempotency is a service-layer concern) ──────

describe('self-transitions are uniformly rejected', () => {
  it.each(ORDER_STATUSES.map((s) => [s] as const))('%s → %s is rejected', (s) => {
    const result = validateTransition(s, s)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('itself')
    expect(result.reason).toContain('service-layer concern')
  })
})

// ─── terminal states — no outbound transitions ──────────────────────

describe('terminal states reject ALL outbound transitions', () => {
  const TERMINAL: OrderStatus[] = ['completed', 'cancelled', 'failed', 'refunded', 'reversed']

  it.each(TERMINAL)('%s is terminal', (s) => {
    expect(isTerminal(s)).toBe(true)
    expect(allowedTransitions(s)).toEqual([])
  })

  // Cartesian product — every terminal × every other status → rejected.
  const allCombos: Array<[OrderStatus, OrderStatus]> = []
  for (const t of TERMINAL) {
    for (const next of ORDER_STATUSES) {
      if (next === t) continue // self-transition tested above
      allCombos.push([t, next])
    }
  }
  it.each(allCombos)('%s → %s rejected (terminal)', (from, to) => {
    const result = validateTransition(from, to)
    expect(result.valid).toBe(false)
    // Either "terminal" message or "cannot transition" — both are valid
    // depending on whether the from has zero allowedNext OR a non-empty
    // allowedNext that doesn't include `to`. Terminal states have
    // empty allowedNext so it's always the "terminal" branch.
    expect(result.reason).toMatch(/terminal/i)
  })
})

// ─── non-terminal states have at least one outbound ─────────────────

describe('non-terminal states have at least one outbound', () => {
  const NON_TERMINAL: OrderStatus[] = [
    'pending',
    'awaiting_payment',
    'paid',
    'refund_requested',
    'disputed',
    'chargeback',
  ]

  it.each(NON_TERMINAL)('%s is non-terminal + has outbound transitions', (s) => {
    expect(isTerminal(s)).toBe(false)
    expect(allowedTransitions(s).length).toBeGreaterThan(0)
  })
})

// ─── result-shape contract ──────────────────────────────────────────

describe('TransitionResult shape', () => {
  it('valid result carries allowedNext (no reason needed)', () => {
    const r = validateTransition('awaiting_payment', 'paid')
    expect(r.valid).toBe(true)
    expect(r.allowedNext).toEqual(['paid', 'cancelled', 'failed'])
    // `reason` is undefined on success (allowed)
    expect(r.reason).toBeUndefined()
  })

  it('invalid result carries reason + allowedNext for caller UI hints', () => {
    const r = validateTransition('paid', 'awaiting_payment')
    expect(r.valid).toBe(false)
    expect(r.reason).toBeDefined()
    expect(r.allowedNext).toEqual(['completed', 'refund_requested', 'disputed'])
  })

  it('NEVER throws — always returns a result object', () => {
    // Exhaustive Cartesian product over (from, to) — none should throw.
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        expect(() => validateTransition(from, to)).not.toThrow()
      }
    }
  })
})

// ─── mapEpsStatusToOrderTransition (the EPS↔order seam) ─────────────

describe('mapEpsStatusToOrderTransition', () => {
  it("'success' → 'paid'", () => {
    expect(mapEpsStatusToOrderTransition('success')).toBe('paid')
  })

  it("'failed' → 'failed'", () => {
    expect(mapEpsStatusToOrderTransition('failed')).toBe('failed')
  })

  it("'cancelled' → 'cancelled'", () => {
    expect(mapEpsStatusToOrderTransition('cancelled')).toBe('cancelled')
  })

  it("'pending' → null (no-op; keep awaiting_payment for retry)", () => {
    expect(mapEpsStatusToOrderTransition('pending')).toBeNull()
  })

  it("'unknown' → null (failure-closed; alert + no transition)", () => {
    expect(mapEpsStatusToOrderTransition('unknown')).toBeNull()
  })

  it('exhaustive over all 5 canonical EpsStatus values', () => {
    const all = ['success', 'failed', 'cancelled', 'pending', 'unknown'] as const
    for (const s of all) {
      // No throws on the canonical alphabet — the function is total.
      expect(() => mapEpsStatusToOrderTransition(s)).not.toThrow()
    }
  })

  it('a successful EPS verify produces a transition that IS legal from awaiting_payment', () => {
    // Composability check: the EpsStatus→OrderStatus map and the
    // validateTransition function compose cleanly — the mapped target
    // is in awaiting_payment's allowedNext list.
    const mapped = mapEpsStatusToOrderTransition('success')!
    const t = validateTransition('awaiting_payment', mapped)
    expect(t.valid).toBe(true)
  })

  it('a failed EPS verify produces a transition that IS legal from awaiting_payment', () => {
    const mapped = mapEpsStatusToOrderTransition('failed')!
    const t = validateTransition('awaiting_payment', mapped)
    expect(t.valid).toBe(true)
  })

  it('a cancelled EPS verify produces a transition that IS legal from awaiting_payment', () => {
    const mapped = mapEpsStatusToOrderTransition('cancelled')!
    const t = validateTransition('awaiting_payment', mapped)
    expect(t.valid).toBe(true)
  })
})

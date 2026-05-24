/**
 * Pure unit tests for event-state-machine.ts — Sprint 3 Day 23.
 *
 * No DB, no mocks, no setup. Every test is `validateTransition(from, to)`
 * → assertion. If these don't pass, the state machine's contract is
 * broken in a way that will break downstream service guards.
 */

import { describe, expect, it } from 'vitest'

import {
  EVENT_STATUSES,
  type EventStatus,
  allowedTransitions,
  isTerminal,
  validateTransition,
} from './event-state-machine.js'

describe('event-state-machine — pure validation', () => {
  describe('legal transitions per §2.4 chain', () => {
    const legal: ReadonlyArray<readonly [EventStatus, EventStatus]> = [
      ['draft', 'published'],
      ['draft', 'archived'],
      ['published', 'on_sale'],
      ['published', 'draft'],
      ['published', 'archived'],
      ['on_sale', 'sold_out'],
      ['on_sale', 'live'],
      ['on_sale', 'archived'],
      ['sold_out', 'live'],
      ['sold_out', 'on_sale'],
      ['live', 'completed'],
      ['completed', 'archived'],
    ]

    it.each(legal)('allows %s → %s', (from, to) => {
      const result = validateTransition(from, to)
      expect(result.valid).toBe(true)
      expect(result.reason).toBeUndefined()
      expect(result.allowedNext).toContain(to)
    })
  })

  describe('disallowed transitions', () => {
    it.each(EVENT_STATUSES)('rejects %s → %s (self-transition)', (state) => {
      const result = validateTransition(state, state)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/to itself/)
    })

    const skips: ReadonlyArray<readonly [EventStatus, EventStatus]> = [
      ['draft', 'on_sale'],
      ['draft', 'sold_out'],
      ['draft', 'live'],
      ['draft', 'completed'],
      ['published', 'sold_out'],
      ['published', 'live'],
      ['published', 'completed'],
      ['on_sale', 'completed'],
      ['sold_out', 'completed'],
    ]

    it.each(skips)('rejects skip %s → %s', (from, to) => {
      const result = validateTransition(from, to)
      expect(result.valid).toBe(false)
      expect(result.reason).toMatch(/cannot transition/i)
    })

    const rewinds: ReadonlyArray<readonly [EventStatus, EventStatus]> = [
      ['on_sale', 'draft'],
      ['on_sale', 'published'],
      ['sold_out', 'draft'],
      ['sold_out', 'published'],
      ['live', 'draft'],
      ['live', 'published'],
      ['live', 'on_sale'],
      ['live', 'sold_out'],
      ['completed', 'draft'],
      ['completed', 'published'],
      ['completed', 'on_sale'],
      ['completed', 'sold_out'],
      ['completed', 'live'],
    ]

    it.each(rewinds)('rejects rewind %s → %s', (from, to) => {
      const result = validateTransition(from, to)
      expect(result.valid).toBe(false)
    })
  })

  describe('archived is terminal', () => {
    it.each(EVENT_STATUSES.filter((s) => s !== 'archived'))(
      'rejects archived → %s (terminal)',
      (to) => {
        const result = validateTransition('archived', to)
        expect(result.valid).toBe(false)
        expect(result.reason).toMatch(/terminal/i)
      },
    )

    it('isTerminal(archived) === true', () => {
      expect(isTerminal('archived')).toBe(true)
    })

    it.each(EVENT_STATUSES.filter((s) => s !== 'archived'))(
      'isTerminal(%s) === false',
      (state) => {
        expect(isTerminal(state)).toBe(false)
      },
    )
  })

  describe('allowedNext is always populated correctly', () => {
    it.each(EVENT_STATUSES)('allowedTransitions(%s) matches the transitions table', (from) => {
      const next = allowedTransitions(from)
      // Each listed transition must itself validate as valid from this state.
      for (const to of next) {
        const result = validateTransition(from, to)
        expect(result.valid).toBe(true)
      }
    })

    it('every state in EVENT_STATUSES appears as a target in at least one transition (no unreachable)', () => {
      const reachableTargets = new Set<EventStatus>()
      for (const from of EVENT_STATUSES) {
        for (const to of allowedTransitions(from)) {
          reachableTargets.add(to)
        }
      }
      // `draft` is the entry state (no transitions INTO it from outside),
      // but it IS reachable via published → draft. Sanity-check all others:
      const expected: ReadonlyArray<EventStatus> = [
        'draft',
        'published',
        'on_sale',
        'sold_out',
        'live',
        'completed',
        'archived',
      ]
      for (const s of expected) {
        expect(reachableTargets.has(s)).toBe(true)
      }
    })
  })

  describe('result shape', () => {
    it('valid result includes allowedNext', () => {
      const result = validateTransition('draft', 'published')
      expect(result.allowedNext).toEqual(['published', 'archived'])
    })

    it('invalid result includes allowedNext (for UI hints)', () => {
      const result = validateTransition('draft', 'live')
      expect(result.allowedNext).toEqual(['published', 'archived'])
    })

    it('terminal-state result has empty allowedNext', () => {
      const result = validateTransition('archived', 'draft')
      expect(result.allowedNext).toEqual([])
    })
  })
})

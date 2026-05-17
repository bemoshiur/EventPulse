import { describe, expect, it } from 'vitest'

import {
  InvalidKycTransitionError,
  canTransition,
  transition,
  type KycSubmissionStatus,
} from './state-machine.js'

/**
 * Pure unit tests for the KYC submission state machine.
 *
 * Maps directly to the Item 9 legal transition graph in
 * `apps/api/src/domain/kyc/state-machine.ts`:
 *
 *   submitted     → under_review
 *   under_review  → approved
 *   under_review  → rejected
 *   rejected      → draft
 *   draft         → submitted   (resubmit completion)
 *
 * Every other transition is illegal and must throw with from/to in
 * the error message so the rejection is greppable in logs.
 */

const LEGAL: ReadonlyArray<[KycSubmissionStatus, KycSubmissionStatus]> = [
  ['submitted', 'under_review'],
  ['under_review', 'approved'],
  ['under_review', 'rejected'],
  ['rejected', 'draft'],
  ['draft', 'submitted'],
]

const ALL_STATES: ReadonlyArray<KycSubmissionStatus> = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
]

describe('KYC state machine', () => {
  describe('transition()', () => {
    it.each(LEGAL)('allows %s → %s', (from, to) => {
      expect(transition(from, to)).toBe(to)
    })

    it('throws on identity transition (e.g. submitted → submitted) — not in legal set', () => {
      expect(() => transition('submitted', 'submitted')).toThrow(InvalidKycTransitionError)
    })

    it('throws when leaving a terminal state (approved → anything)', () => {
      for (const to of ALL_STATES) {
        expect(() => transition('approved', to)).toThrow(InvalidKycTransitionError)
      }
    })

    it('throws on every illegal pair with from/to in the error message', () => {
      const legalSet = new Set(LEGAL.map(([from, to]) => `${from}→${to}`))
      for (const from of ALL_STATES) {
        for (const to of ALL_STATES) {
          if (legalSet.has(`${from}→${to}`)) continue
          try {
            transition(from, to)
            expect.fail(`Expected throw for ${from} → ${to}`)
          } catch (err) {
            expect(err).toBeInstanceOf(InvalidKycTransitionError)
            if (err instanceof InvalidKycTransitionError) {
              expect(err.from).toBe(from)
              expect(err.to).toBe(to)
              expect(err.message).toContain(from)
              expect(err.message).toContain(to)
            }
          }
        }
      }
    })

    it('blocks the most-tempting illegal jumps (skip-review, demote-from-approved, undo-rejection)', () => {
      // Reviewer cannot approve without first picking up the submission
      expect(() => transition('submitted', 'approved')).toThrow(InvalidKycTransitionError)
      // Once approved, no path back to under_review or rejected (a new submission row is required)
      expect(() => transition('approved', 'under_review')).toThrow(InvalidKycTransitionError)
      expect(() => transition('approved', 'rejected')).toThrow(InvalidKycTransitionError)
      // Rejected does NOT go directly back to under_review — tenant must resubmit (draft → submitted)
      expect(() => transition('rejected', 'under_review')).toThrow(InvalidKycTransitionError)
      expect(() => transition('rejected', 'approved')).toThrow(InvalidKycTransitionError)
      // Draft cannot jump straight to under_review either — must go through submitted
      expect(() => transition('draft', 'under_review')).toThrow(InvalidKycTransitionError)
    })
  })

  describe('canTransition()', () => {
    it.each(LEGAL)('returns true for legal pair %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(true)
    })

    it('returns false for the same illegal jumps that throw()', () => {
      expect(canTransition('submitted', 'approved')).toBe(false)
      expect(canTransition('approved', 'under_review')).toBe(false)
      expect(canTransition('rejected', 'approved')).toBe(false)
    })

    it('returns false (never throws) for unknown from-state', () => {
      // Defensive: even if a row's status drifts via a manual SQL fix,
      // canTransition() should give the UI a clean false rather than
      // exploding the legality hint.
      expect(canTransition('archived' as KycSubmissionStatus, 'submitted')).toBe(false)
    })
  })

  describe('InvalidKycTransitionError', () => {
    it('exposes name + from + to as own properties', () => {
      const err = new InvalidKycTransitionError('approved', 'rejected')
      expect(err.name).toBe('InvalidKycTransitionError')
      expect(err.from).toBe('approved')
      expect(err.to).toBe('rejected')
    })
  })
})

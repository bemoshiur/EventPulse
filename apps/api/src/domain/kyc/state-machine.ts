/**
 * KYC submission state machine — Sprint 2 Day 14 Item 9.
 *
 * Implements the transition graph from CLAUDE.md §13.3 plus the
 * rejected → draft resubmit lane added in Sprint 2 (decisions.md
 * 2026-05-17 "Sprint 2 Item 10 scope amendment" leaves Item 9's state
 * machine spec as the authoritative shape; v2.3 closeout bump amends
 * §13.3 to match).
 *
 * Row-creation vs transition split (intentional, do not collapse):
 *
 *   • Row creation (first-write) does NOT route through transition().
 *     The route handler calls `createKycSubmission()` which inserts the
 *     row directly in status='submitted'. The de-facto-draft phase at
 *     submission time is the Day 13 upload-url step, which has no DB
 *     row to transition from. Introducing a synthetic null→submitted
 *     transition would add a double-write (insert as 'draft', then
 *     update to 'submitted') with no functional gain — the resubmit
 *     lane is the only path that needs 'draft' at the database layer.
 *
 *   • transition() handles transitions of EXISTING rows only. Every
 *     legal transition listed below corresponds to an action by a
 *     real actor (a reviewer approving, a tenant resubmitting) on a
 *     row that already exists.
 *
 * Legal transitions:
 *
 *   submitted     → under_review     (reviewer picks up the submission)
 *   under_review  → approved         (reviewer approves)
 *   under_review  → rejected         (reviewer rejects, with reason)
 *   rejected      → draft            (tenant starts a resubmit)
 *   draft         → submitted        (tenant finalises the resubmit)
 *
 * All other transitions throw InvalidKycTransitionError with from/to
 * labels in the message so the rejection is greppable.
 */

export type KycSubmissionStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected'

const LEGAL_TRANSITIONS: ReadonlyMap<
  KycSubmissionStatus,
  ReadonlySet<KycSubmissionStatus>
> = new Map([
  ['submitted', new Set<KycSubmissionStatus>(['under_review'])],
  ['under_review', new Set<KycSubmissionStatus>(['approved', 'rejected'])],
  ['rejected', new Set<KycSubmissionStatus>(['draft'])],
  ['draft', new Set<KycSubmissionStatus>(['submitted'])],
  // 'approved' is a terminal state — no transitions out. A new
  // submission (different row, different submission_id) is required
  // to recover from an erroneous approval.
  ['approved', new Set<KycSubmissionStatus>()],
])

export class InvalidKycTransitionError extends Error {
  readonly from: KycSubmissionStatus
  readonly to: KycSubmissionStatus

  constructor(from: KycSubmissionStatus, to: KycSubmissionStatus) {
    super(`Invalid KYC submission transition: ${from} → ${to}`)
    this.name = 'InvalidKycTransitionError'
    this.from = from
    this.to = to
  }
}

/**
 * Assert that a state transition is legal. Throws InvalidKycTransitionError
 * if not. Returns the destination state on success so callers can chain.
 *
 * Pure function — no DB access, no side effects. Apply this before any
 * write to kyc_submissions.status; pair with `writeKycTransition()`
 * (apps/api/src/services/audit/kyc.ts) inside the same transaction so
 * the audit row and the state change land atomically.
 */
export function transition(
  from: KycSubmissionStatus,
  to: KycSubmissionStatus,
): KycSubmissionStatus {
  const allowed = LEGAL_TRANSITIONS.get(from)
  if (!allowed || !allowed.has(to)) {
    throw new InvalidKycTransitionError(from, to)
  }
  return to
}

/**
 * Predicate form for callers that prefer a boolean to a throw.
 * The route handler uses `transition()` directly so the error
 * propagates into the standard onError envelope; reviewer-side UI
 * code may prefer this form for client-rendered legality hints.
 */
export function canTransition(from: KycSubmissionStatus, to: KycSubmissionStatus): boolean {
  return LEGAL_TRANSITIONS.get(from)?.has(to) ?? false
}

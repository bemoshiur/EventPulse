/**
 * KYC submission state machine — Sprint 2 Day 14 Item 9 + Day 16 Item 12.
 *
 * Implements the transition graph from CLAUDE.md §13.3 plus the
 * `rejected → draft → submitted` resubmit lane added Day 14, plus the
 * wizard's `(create-as-draft) → submitted` lane added Day 16
 * (decisions.md 2026-05-18 "KYC wizard uses server-side drafts").
 * v2.3 playbook bump (Day 18 AM) amends §13.3 to document both lanes.
 *
 * Row-creation vs transition split (intentional, do not collapse):
 *
 *   • Row creation (first-write) does NOT route through transition().
 *     Two creation paths exist:
 *
 *       1. Direct-submit (Item 9 — `POST /tenant/kyc/submissions`):
 *          inserts the row directly in status='submitted'. The de-facto-
 *          draft phase is the Day 13 upload-url step. No DB row to
 *          transition from. Audit: `kyc_submission.transition` with
 *          from=null, to='submitted'.
 *
 *       2. Wizard create-as-draft (Item 12 — `POST /tenant/kyc/drafts`):
 *          inserts the row directly in status='draft'. The wizard PATCHes
 *          the draft row across steps; only the final submit moves it
 *          through transition('draft', 'submitted'). Audit:
 *          `kyc_submission.draft_created` (helper:
 *          `writeKycDraftCreated()` in services/audit/kyc.ts).
 *
 *     Both creation paths bypass transition() because there's no
 *     prior state to transition from. transition() handles ONLY
 *     transitions of EXISTING rows.
 *
 *   • transition() handles transitions of EXISTING rows only. Every
 *     legal transition listed below corresponds to an action by a
 *     real actor (a reviewer approving, a tenant resubmitting, the
 *     wizard finalising a draft) on a row that already exists.
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

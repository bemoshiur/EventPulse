/**
 * Order state machine — Sprint 3 Day 27 Phase 1.
 *
 * PURE validation function. Mirrors the design discipline of
 * `event-state-machine.ts` (Sprint 3 Day 23) + `fee-calculator.ts`
 * (Sprint 3 Day 21): one place, deterministic, no side effects,
 * fully unit-testable in isolation.
 *
 * **What this module knows:**
 *
 *   - The 11-state set per CLAUDE.md §9.5 + the live `orders_status_chk`
 *     constraint (verified Day 27 Phase 0):
 *
 *       pending, awaiting_payment, paid, completed, cancelled, failed,
 *       refund_requested, refunded, disputed, chargeback, reversed
 *
 *   - Which transitions are legal between any two states, per §2.5
 *     (Order Lifecycle).
 *
 *   - Five terminal states (no outbound transitions):
 *     completed, cancelled, failed, refunded, reversed.
 *
 *   - That self-transitions (X → X) are rejected — idempotency on
 *     "re-delivered webhook" cases is the SERVICE layer's
 *     responsibility (check current status BEFORE calling
 *     validateTransition; no-op if already at target).
 *
 * **What this module does NOT know:**
 *
 *   - Whether the order has been EPS-verified (Day 27 service-layer
 *     concern — the webhook + redirect handlers call verifyOrder()
 *     against EPS, then ask this module if the transition is legal).
 *
 *   - Whether a refund has been EPS-processed (Day 30+ settlement
 *     concern — refund_requested → refunded transition requires
 *     out-of-band EPS API + manual reviewer per §11.4).
 *
 *   - Whether the disputed/chargeback path applies (handled by EPS
 *     reconciliation Day 27+ + chargeback handler Day 30+).
 *
 *   - Whether `paid → completed` should fire automatically post-event
 *     or via manual review — that's a cron + settlement concern.
 *
 * **Service-layer composition pattern (canonical):**
 *
 * ```ts
 * async function settleOrder(orderId, eps_status, actor) {
 *   const order = await read(orderId)
 *   const target = mapEpsStatusToOrderStatus(eps_status)
 *   // Idempotent fast-path: re-delivered webhook for already-settled order
 *   if (order.status === target) return { idempotent: true }
 *   const t = validateTransition(order.status, target)
 *   if (!t.valid) throw new AppError('INVALID_TRANSITION', t.reason)
 *   await applyTransitionTx(orderId, target, actor)  // service-layer write
 * }
 * ```
 *
 * Idempotency is the SERVICE layer's job; the state machine is purely
 * about legality. Same-input/same-output is preserved.
 *
 * **Why some transitions exist that current code doesn't yet fire:**
 *
 *   - `pending → awaiting_payment`: legal per §2.5 + §11.1. Day 26
 *     `createOrder` skips `pending` and inserts directly into
 *     `awaiting_payment`. If a future flow needs a draft-order state
 *     (e.g. "save for later", multi-step checkout), `pending` becomes
 *     the initial state and this transition lights up.
 *   - `paid → refund_requested → refunded` + `paid → disputed →
 *     chargeback → reversed`: lands at Day 30+ (settlement +
 *     chargeback handler). Encoded now so the state machine doesn't
 *     need to change when those services land.
 *
 * Cross-reference: CLAUDE.md §2.5 (lifecycle narrative), §9.5
 * (status enum), §11.1 (EPS init → awaiting_payment → verify → paid/
 * failed/cancelled), §11.4 (refund out-of-band); migration 0013
 * (the live CHECK constraint). decisions.md 2026-05-25 "Day 26
 * architectural choices" Choice A (pure-validation discipline
 * carries forward).
 */

import { z } from 'zod'

/**
 * The 11 legal order statuses per §9.5 + the live `orders_status_chk`
 * constraint. Order of array elements is irrelevant.
 */
export const ORDER_STATUSES = [
  'pending',
  'awaiting_payment',
  'paid',
  'completed',
  'cancelled',
  'failed',
  'refund_requested',
  'refunded',
  'disputed',
  'chargeback',
  'reversed',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** Zod schema for runtime validation at service boundaries. */
export const orderStatusSchema = z.enum(ORDER_STATUSES)

/**
 * Allowed transitions: map of FROM → list of legal TOs.
 *
 * Encodes §2.5's lifecycle narrative + the §11.1 EPS-init/verify flow:
 *
 * **Pre-payment phase:**
 *
 *   - `pending` → `awaiting_payment` (EPS init succeeds)
 *   - `pending` → `cancelled` (buyer abandons pre-init)
 *   - `pending` → `failed` (init errored irrecoverably)
 *
 * **Post-init verification phase (the Day 27 hot path):**
 *
 *   - `awaiting_payment` → `paid` (verify returns success)
 *   - `awaiting_payment` → `cancelled` (verify returns cancelled or
 *     user-cancel redirect reconciled with verify)
 *   - `awaiting_payment` → `failed` (verify returns failed)
 *
 * **Post-payment phase (Day 28+ delivery + Day 30+ settlement):**
 *
 *   - `paid` → `completed` (event happened, tickets used)
 *   - `paid` → `refund_requested` (tenant or buyer initiated refund —
 *     Day 30+ refund-management surface)
 *   - `paid` → `disputed` (EPS chargeback-initiation webhook — Day 30+
 *     dispute handler)
 *
 * **Refund subpath:**
 *
 *   - `refund_requested` → `refunded` (EPS processed via merchant
 *     dashboard per §11.4 + reviewer-approved)
 *
 * **Dispute subpath:**
 *
 *   - `disputed` → `chargeback` (EPS-confirmed chargeback)
 *   - `chargeback` → `reversed` (chargeback reversal — defended
 *     successfully)
 *
 * **Terminal states (no outbound transitions):**
 *
 *   - `completed`, `cancelled`, `failed`, `refunded`, `reversed`
 *
 * Anything NOT listed in a value array is implicitly disallowed.
 *
 * **Load-bearing negative cases (tests pin these):**
 *
 *   - `paid → awaiting_payment` (rewind a settled payment — fraud
 *     vector if allowed)
 *   - `paid → paid` (self-transition — idempotency is a service-layer
 *     concern; state machine rejects)
 *   - `cancelled → paid` (resurrect a cancelled order — bypasses
 *     re-creation flow)
 *   - `awaiting_payment → completed` (skip the paid step — would
 *     allow unfunded orders to be marked complete)
 *   - any X → X
 *   - any FROM a terminal state
 *   - any FROM/TO outside the 11-state enum (TypeScript catches; the
 *     `validateTransition` runtime check is defensive)
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['awaiting_payment', 'cancelled', 'failed'],
  // `awaiting_payment → disputed` is the v1.0 single-method-launch
  // verify-guard path (decisions.md 2026-05-31 "EPS fee-model
  // structural decision — Option 3 CHOSEN" + Day 38 Phase 2 mechanism
  // (d)). When EPS Verify returns Success but the buyer used a
  // non-bKash payment method, the order skips the `paid` intermediate
  // and goes straight to `disputed` — the platform refuses to honor
  // the order because the payment method violates the launch's
  // single-method constraint. The state-machine permits the direct
  // transition because semantically the order was never honored; it
  // was disputed at the verify boundary.
  awaiting_payment: ['paid', 'cancelled', 'failed', 'disputed'],
  paid: ['completed', 'refund_requested', 'disputed'],
  completed: [], // terminal
  cancelled: [], // terminal
  failed: [], // terminal
  refund_requested: ['refunded'],
  refunded: [], // terminal
  // Two valid forward paths from `disputed`, each tied to a distinct
  // dispute reason captured in audit trail / order_events payload:
  //
  //   1. `disputed → chargeback → reversed` — EPS-initiated dispute path
  //      per §2.5 lifecycle. Engaged when EPS issues a chargeback against
  //      a previously-paid order. Day 30+ chargeback handler scope.
  //
  //   2. `disputed → refunded` — Day 39 Phase 2b platform-initiated
  //      dispute resolution for the v1.0 non-bKash Verify-guard path
  //      (decisions.md 2026-05-31 Day 39 Phase 2b). When the Verify-
  //      guard diverts an order to `disputed` (Day 38 Phase 2a / PR #228)
  //      and the super-admin manually completes the refund via the EPS
  //      merchant dashboard (V5 has no public refund API per §11.4), the
  //      super-admin marks the order refunded via the Phase 2b admin
  //      endpoint. No chargeback intermediate because the dispute was
  //      our call, not EPS's.
  //
  // §2.5 lifecycle narrative reflects only path 1; v2.4 playbook bump
  // backlog includes updating §2.5 to document path 2.
  disputed: ['chargeback', 'refunded'],
  chargeback: ['reversed'],
  reversed: [], // terminal
}

export interface TransitionResult {
  valid: boolean
  /** When invalid: human-readable reason for the AppError message. */
  reason?: string
  /** From the current `from` state, what transitions are legal? */
  allowedNext: readonly OrderStatus[]
}

/**
 * Validate a requested state transition.
 *
 * Returns `{ valid, allowedNext }` — NEVER throws. Service-layer
 * callers branch on `.valid` and use `.reason` for the error message,
 * `.allowedNext` for UI/audit hints.
 *
 * Pure: no I/O, no time-of-day, no DB. Same inputs → same outputs.
 *
 * **Note on idempotency:** self-transitions (X → X) are rejected as
 * invalid here. The CALLER (e.g. the webhook handler) is responsible
 * for the "already at target" idempotent short-circuit BEFORE
 * invoking this function. See the file header for the pattern.
 */
export function validateTransition(from: OrderStatus, to: OrderStatus): TransitionResult {
  const allowedNext = TRANSITIONS[from]

  if (from === to) {
    return {
      valid: false,
      reason: `Cannot transition order from '${from}' to itself (idempotency is a service-layer concern).`,
      allowedNext,
    }
  }

  if (allowedNext.length === 0) {
    return {
      valid: false,
      reason: `Order status '${from}' is terminal; no transitions are allowed.`,
      allowedNext,
    }
  }

  if (!allowedNext.includes(to)) {
    return {
      valid: false,
      reason:
        `Order cannot transition from '${from}' to '${to}'. ` +
        `Allowed: ${allowedNext.length ? allowedNext.join(', ') : '(none — terminal)'}.`,
      allowedNext,
    }
  }

  return { valid: true, allowedNext }
}

/**
 * Convenience: list legal transitions out of `from` without requiring
 * a target. Useful for UI ("which actions are available?") and for
 * test setup.
 */
export function allowedTransitions(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from]
}

/** Terminal state (no outbound transitions)? */
export function isTerminal(state: OrderStatus): boolean {
  return TRANSITIONS[state].length === 0
}

/**
 * Map an EPS-canonical status (the output of `normaliseStatus`) to the
 * order status the platform should transition to.
 *
 * Per CLAUDE.md §11.1 step 10:
 *   - SUCCESS / COMPLETED → 'paid'
 *   - FAILED / FAILURE    → 'failed'
 *   - CANCELLED / CANCEL  → 'cancelled'
 *   - PENDING             → no-op (keep awaiting_payment; retry verify later)
 *   - unknown             → no-op (failure-closed; logged + alert)
 *
 * Returns `null` when the EPS status does not warrant a transition —
 * caller should treat as "no state change". Returns the target
 * `OrderStatus` when a transition should be attempted.
 *
 * Pure function. Pairs with `normaliseStatus` from
 * `apps/api/src/infra/eps/normalise-status.ts` — these two together
 * form the contract surface between the EPS layer and the
 * order-state layer.
 */
export function mapEpsStatusToOrderTransition(
  epsStatus: 'success' | 'failed' | 'cancelled' | 'pending' | 'unknown',
): OrderStatus | null {
  switch (epsStatus) {
    case 'success':
      return 'paid'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'pending':
    case 'unknown':
    default:
      return null
  }
}

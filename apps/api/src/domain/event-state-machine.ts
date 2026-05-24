/**
 * Event state machine — Sprint 3 Day 23 Workstream 1.
 *
 * PURE validation function. Mirrors the design discipline of
 * fee-calculator.ts (the single source of money truth): one place,
 * deterministic, no side effects, fully unit-testable in isolation.
 *
 * What this module knows:
 *
 *   - The 7-state chain per CLAUDE.md §2.4:
 *
 *       draft → published → on_sale → sold_out (optional) → live → completed → archived
 *
 *   - Which transitions are legal between any two states.
 *   - That `archived` is terminal (no outbound transitions).
 *   - That self-transitions (X → X) are rejected.
 *
 * What this module does NOT know:
 *
 *   - Whether the event has at least one ticket tier (services-layer
 *     guard at publish time; Day 25 work hooks in here).
 *   - Whether any orders have been placed (services-layer guard for
 *     published → draft rollback).
 *   - Whether starts_at has been reached (cron-layer concern for
 *     on_sale/sold_out → live).
 *   - Whether capacity is exhausted (capacity-layer concern for
 *     on_sale → sold_out; Day 25+).
 *   - Whether the event has been paid for (settlement-layer concern
 *     for cancellation refunds).
 *
 * Service-layer composition pattern (canonical — services consume the
 * pure result, then layer their own guards + write side effects):
 *
 *   async function publishEvent(eventId, actor) {
 *     const event = await read(eventId)
 *     const t = validateTransition(event.status, 'published')
 *     if (!t.valid) throw new AppError('INVALID_TRANSITION', t.reason)
 *     // service-level guards: ≥1 tier, venue valid, dates valid, …
 *     // mutation + audit
 *   }
 *
 * This keeps validation testable in isolation (pure inputs → pure
 * outputs, no mocks needed) and lets downstream layers add guards
 * additively without touching the state-machine code.
 *
 * Cross-reference: CLAUDE.md §2.4 (lifecycle chain), §6.1 (services
 * pattern), §1.3 R8 (audit every state change at the service layer),
 * .claude/memory/decisions.md 2026-05-24 (pure-validation discipline
 * gate from Day 23 pre-flight resolution).
 */

import { z } from 'zod'

/** The seven legal event states, per §2.4 + the events_status_chk constraint. */
export const EVENT_STATUSES = [
  'draft',
  'published',
  'on_sale',
  'sold_out',
  'live',
  'completed',
  'archived',
] as const

export type EventStatus = (typeof EVENT_STATUSES)[number]

/** Zod schema for runtime validation at service boundaries. */
export const eventStatusSchema = z.enum(EVENT_STATUSES)

/**
 * Allowed transitions: map of FROM → list of legal TOs.
 *
 * The shape mirrors §2.4's linear chain with three justified exceptions:
 *
 *   1. `draft → archived` + `published → archived` + `on_sale → archived`
 *      + `completed → archived` — `archived` is reachable from multiple
 *      points because it represents tenant-driven cleanup (abandoned
 *      drafts, cancelled events, post-event tidying). It is not the
 *      sole linear successor of `completed`.
 *
 *   2. `published → draft` — pre-sale rollback. Service-layer guard
 *      blocks this if any orders exist (which is impossible pre-sale
 *      because sales aren't open, but defends against tier-creation
 *      flows that might create orders in unusual states later).
 *
 *   3. `sold_out → on_sale` — capacity bump or waitlist promotion.
 *      Capacity is mutable; the state machine reflects that.
 *
 * Anything NOT listed in the value array is implicitly disallowed.
 *
 * Disallowed-and-load-bearing examples (negative cases the test suite
 * locks in):
 *   - draft → live (skip)
 *   - live → published (rewind in-progress)
 *   - completed → live (rewind finished)
 *   - archived → anything (terminal)
 *   - any X → X (no self-transition)
 */
const TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  draft: ['published', 'archived'],
  published: ['on_sale', 'draft', 'archived'],
  on_sale: ['sold_out', 'live', 'archived'],
  sold_out: ['live', 'on_sale'],
  live: ['completed'],
  completed: ['archived'],
  archived: [], // terminal
}

export interface TransitionResult {
  valid: boolean
  /** When invalid: human-readable reason for the AppError message. */
  reason?: string
  /** From the current `from` state, what transitions are legal? */
  allowedNext: readonly EventStatus[]
}

/**
 * Validate a requested state transition.
 *
 * Returns `{ valid, allowedNext }` — never throws. Service-layer callers
 * branch on `.valid` and use `.reason` for the error message, `.allowedNext`
 * for UI hints (e.g. populating a "what can I do next" menu).
 *
 * Pure: no I/O, no time-of-day, no DB. Same inputs → same outputs.
 */
export function validateTransition(from: EventStatus, to: EventStatus): TransitionResult {
  const allowedNext = TRANSITIONS[from]

  if (from === to) {
    return {
      valid: false,
      reason: `Cannot transition event from '${from}' to itself.`,
      allowedNext,
    }
  }

  if (allowedNext.length === 0) {
    return {
      valid: false,
      reason: `Event status '${from}' is terminal; no transitions are allowed.`,
      allowedNext,
    }
  }

  if (!allowedNext.includes(to)) {
    return {
      valid: false,
      reason:
        `Event cannot transition from '${from}' to '${to}'. ` +
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
export function allowedTransitions(from: EventStatus): readonly EventStatus[] {
  return TRANSITIONS[from]
}

/** Terminal state (no outbound transitions)? Currently: archived only. */
export function isTerminal(state: EventStatus): boolean {
  return TRANSITIONS[state].length === 0
}

/**
 * Offline-queue sync orchestrator.
 * Sprint 4 Day 31 Phase 3.
 *
 * Pure-but-IO function that:
 *   1. Reads every pending scan from the queue.
 *   2. POSTs each to the server's check-in endpoint (sequentially —
 *      sync ordering is irrelevant per row, and serial avoids
 *      hammering the server when a device comes back from a long
 *      offline stretch with hundreds of scans).
 *   3. On any DEFINITIVE outcome (the server replied — CHECKED_IN,
 *      ALREADY_CHECKED_IN, INVALID, WRONG_EVENT, VOIDED), removes
 *      the row from the queue. The DECISION has been made; the
 *      row is no longer pending.
 *   4. On network-error outcome (server didn't reply), leaves the
 *      row IN the queue for the next sync attempt.
 *   5. Returns a per-row sync report so the UI can flag duplicates
 *      ("offline scan tentatively-admitted but server says
 *      ALREADY_CHECKED_IN — that's a duplicate-on-sync, surface to
 *      ops").
 *
 * ════════════════════════════════════════════════════════════════════
 * Why server is the FINAL authority (per Phase 1 design)
 * ════════════════════════════════════════════════════════════════════
 *
 * The offline-side admit is OPTIMISTIC — door staff was told "OK
 * admit" based on the device's local "this token format looks
 * plausible" check. The server's check-in service (Phase 1) is
 * the ONLY source of truth. When two offline devices both admitted
 * the same ticket, the server's compare-and-swap admits exactly
 * one; the loser's sync gets ALREADY_CHECKED_IN; the device knows
 * its "tentative admit" was an unsynced duplicate and surfaces
 * that to ops.
 *
 * Pinned by `decisions.md` "Day 31 — Optimistic-admit offline
 * check-in".
 */

import { listPending, markSyncedAndRemove, type PendingScan } from './offline-checkin-queue'

// ─── outcome types ──────────────────────────────────────────────────

/**
 * The per-row sync outcome. `definitive` outcomes remove the row;
 * `network_error` leaves it in for the next sync.
 *
 * `duplicate_on_sync` is a `definitive` outcome with a UI flag —
 * the server said ALREADY but the device had marked it "tentatively
 * admitted" offline. Surfacing this distinguishes "scanned twice on
 * one device" from "scanned offline on two devices; second device
 * lost the race."
 */
export type SyncOutcome =
  | { kind: 'admitted' } // CHECKED_IN — first scan, no conflict
  | { kind: 'duplicate_on_sync' } // ALREADY_CHECKED_IN — offline conflict
  | { kind: 'invalid' } // TICKET_INVALID — forged / voided / wrong event
  | { kind: 'wrong_event' }
  | { kind: 'voided' }
  | { kind: 'network_error'; message: string } // server didn't reply; retry

export interface SyncReportRow {
  pendingId: string
  outcome: SyncOutcome
}

export interface SyncReport {
  attempted: number
  removed: number // definitive outcomes; row removed from queue
  retained: number // network errors; row left for retry
  duplicateCount: number // for ops alerting
  rows: SyncReportRow[]
}

// ─── sync function ──────────────────────────────────────────────────

/**
 * Sync the queue. Returns a per-row report. Caller decides whether
 * to surface the duplicateCount as a "review duplicate scans" alert.
 */
export async function syncCheckinQueue(deps: {
  apiBase: string
  /** Pre-built fetch (e.g. with credentials: 'include'). */
  fetcher?: typeof fetch
  factory?: IDBFactory | null
}): Promise<SyncReport> {
  const fetcher = deps.fetcher ?? fetch
  const factory = deps.factory ?? null

  const pending = await listPending(factory)
  const rows: SyncReportRow[] = []
  let removed = 0
  let retained = 0
  let duplicateCount = 0

  for (const scan of pending) {
    const outcome = await postOne(scan, deps.apiBase, fetcher)
    rows.push({ pendingId: scan.id, outcome })
    if (outcome.kind === 'network_error') {
      retained++
    } else {
      await markSyncedAndRemove(scan.id, factory)
      removed++
      if (outcome.kind === 'duplicate_on_sync') duplicateCount++
    }
  }

  return {
    attempted: pending.length,
    removed,
    retained,
    duplicateCount,
    rows,
  }
}

async function postOne(
  scan: PendingScan,
  apiBase: string,
  fetcher: typeof fetch,
): Promise<SyncOutcome> {
  try {
    const res = await fetcher(`${apiBase}/api/v1/tenant/events/${scan.eventId}/checkin`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ qrCode: scan.qrCode, gate: scan.gate }),
    })
    if (res.status === 200) return { kind: 'admitted' }
    const body = (await res.json().catch(() => null)) as { error: { code: string } } | null
    const code = body?.error?.code
    if (code === 'ATTENDEE_ALREADY_CHECKED_IN') return { kind: 'duplicate_on_sync' }
    if (code === 'TICKET_WRONG_EVENT') return { kind: 'wrong_event' }
    if (code === 'TICKET_VOIDED') return { kind: 'voided' }
    return { kind: 'invalid' }
  } catch (err) {
    return { kind: 'network_error', message: (err as Error).message }
  }
}

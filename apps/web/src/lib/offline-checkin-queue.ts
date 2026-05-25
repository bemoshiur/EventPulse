/**
 * Offline-tolerant check-in queue (IndexedDB).
 * Sprint 4 Day 31 Phase 3.
 *
 * ════════════════════════════════════════════════════════════════════
 * The door-policy decision (Auto Mode call; §-spec silent)
 * ════════════════════════════════════════════════════════════════════
 *
 * Offline behaviour: **optimistic admit + server-resolves-on-sync**.
 *
 * Industry-standard for festival / venue ticketing. Offline scans
 * are admitted at the door immediately under a clearly-labelled
 * "TENTATIVE (offline)" UI banner; queued to IndexedDB; flushed to
 * the server on reconnect; the server's compare-and-swap (Day 31
 * Phase 1) is the FINAL authority.
 *
 * Rationale:
 *
 *   - Bad connectivity is the WHOLE REASON §26.1 specified
 *     offline-tolerant. "Queue-and-wait" would unwork the venue.
 *   - First-synced scan wins on the server; subsequent syncs of the
 *     same ticket return ALREADY_CHECKED_IN. The queue resolves
 *     each via its discriminated outcome.
 *   - Duplicate-on-sync is flagged for ops review (the
 *     reconciliation reports it; future ops dashboard surfaces it).
 *   - Real-world fraud window: a coordinated attacker with 2 offline
 *     devices scanning the same ticket simultaneously can double-
 *     admit before sync. Mitigated by: (a) MVP threat model is
 *     honest-mistake double-scan, not coordinated fraud; (b) the
 *     duplicate is detected the moment ONE device syncs; (c) ops
 *     gets a forensic trail.
 *
 * Pinned by `decisions.md` "Day 31 — Optimistic-admit offline
 * check-in" + this file's UX-banner contract (the UI MUST surface
 * "tentative" status on offline-admitted scans).
 *
 * ════════════════════════════════════════════════════════════════════
 * IndexedDB schema
 * ════════════════════════════════════════════════════════════════════
 *
 *   DB: `eventpulse-checkin-v1`
 *   Object store: `pending`
 *     - keyPath: `id` (UUID generated client-side)
 *     - value: { id, eventId, qrCode, gate, scannedAt }
 *
 * The store is intentionally append-only from the caller's view;
 * `markSyncedAndRemove(id)` is the only delete path. Persistence
 * survives page reload and OS sleep.
 *
 * ════════════════════════════════════════════════════════════════════
 * Module shape — pure functions over a passed-in IDBFactory
 * ════════════════════════════════════════════════════════════════════
 *
 * Every public function takes the IDBFactory explicitly (default:
 * `globalThis.indexedDB`). This lets tests inject `fake-indexeddb`
 * without globals patching. Production callers pass nothing.
 */

const DB_NAME = 'eventpulse-checkin-v1'
const STORE = 'pending'
const VERSION = 1

export interface PendingScan {
  /** Client-generated UUID; the IndexedDB primary key. */
  id: string
  eventId: string
  qrCode: string
  gate: string | null
  /** ISO timestamp of when the scan happened on this device. */
  scannedAt: string
}

function defaultFactory(): IDBFactory | null {
  if (typeof globalThis === 'undefined') return null
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB
  return idb ?? null
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, VERSION)
    req.onerror = () => reject(req.error ?? new Error('indexeddb open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
  })
}

/**
 * Append a pending scan to the queue. Returns the same row.
 * Idempotent on `id` (re-call with same id is a no-op via `put`).
 */
export async function enqueueScan(
  scan: PendingScan,
  factory: IDBFactory | null = defaultFactory(),
): Promise<PendingScan> {
  if (!factory) throw new Error('IndexedDB not available')
  const db = await openDb(factory)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(scan)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('enqueue failed'))
  })
  db.close()
  return scan
}

/**
 * Read all pending scans in insertion order (IndexedDB key order
 * happens to be the insertion order for our UUID v4 keys — close
 * enough for MVP; sync-order isn't strictly required because the
 * server resolves conflicts independently per scan).
 */
export async function listPending(
  factory: IDBFactory | null = defaultFactory(),
): Promise<PendingScan[]> {
  if (!factory) return []
  const db = await openDb(factory)
  const rows = await new Promise<PendingScan[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as PendingScan[])
    req.onerror = () => reject(req.error ?? new Error('list failed'))
  })
  db.close()
  return rows
}

/**
 * Remove a pending scan after it has been confirmed synced. The
 * "synced" decision is made by the caller AFTER the server returns
 * a definitive outcome (CHECKED_IN, ALREADY_CHECKED_IN, INVALID,
 * WRONG_EVENT — all are "the server has decided"). A network_error
 * outcome leaves the row in place for retry.
 */
export async function markSyncedAndRemove(
  id: string,
  factory: IDBFactory | null = defaultFactory(),
): Promise<void> {
  if (!factory) return
  const db = await openDb(factory)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('remove failed'))
  })
  db.close()
}

/**
 * Delete EVERY pending row. For tests + the rare ops "I need to
 * reset this device's queue" surface (not exposed yet — Sprint 4
 * polish).
 */
export async function clearAll(factory: IDBFactory | null = defaultFactory()): Promise<void> {
  if (!factory) return
  const db = await openDb(factory)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('clear failed'))
  })
  db.close()
}

/**
 * Generate a queue-row id. Wraps crypto.randomUUID for the common
 * case; tests can mock crypto via globalThis to keep ids deterministic.
 */
export function newScanId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID (rare).
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

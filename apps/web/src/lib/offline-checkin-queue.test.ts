/**
 * Offline check-in queue + sync — unit tests.
 * Sprint 4 Day 31 Phase 3.
 *
 * Pinned correctness invariants for the OPTIMISTIC-ADMIT design:
 *
 *   1. **Persistence across "reload".** Enqueue → re-open DB (simulated
 *      via a fresh factory pointing at the same store) → row survives.
 *   2. **Sync idempotency.** Re-running sync against an already-empty
 *      queue is a no-op. Re-syncing after a successful flush doesn't
 *      re-POST anything.
 *   3. **Definitive outcomes remove the row.** CHECKED_IN, ALREADY,
 *      INVALID, WRONG_EVENT, VOIDED all delete the pending row.
 *      network_error leaves it in place for retry.
 *   4. **The offline-double-entry case** — TWO offline scans of the
 *      same ticket get enqueued, sync them sequentially: the FIRST
 *      gets CHECKED_IN (server admits), the SECOND gets
 *      ALREADY_CHECKED_IN tagged `duplicate_on_sync` (the surfacing
 *      flag for ops). BOTH removed from the queue (server has
 *      decided on both); sync report.duplicateCount == 1.
 *   5. **Network errors retry next sync.** Scan stays in queue.
 *
 * Uses fake-indexeddb to model the persistence layer; uses a fake
 * fetcher to control server outcomes deterministically.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import 'fake-indexeddb/auto'

import {
  clearAll,
  enqueueScan,
  listPending,
  markSyncedAndRemove,
  newScanId,
  type PendingScan,
} from './offline-checkin-queue'

import { syncCheckinQueue } from './sync-checkin-queue'

const factory = (globalThis as { indexedDB: IDBFactory }).indexedDB

beforeEach(async () => {
  await clearAll(factory)
})

afterEach(async () => {
  await clearAll(factory)
})

// ─── enqueue / list / persist ───────────────────────────────────────

describe('offline-checkin-queue — enqueue + list + persist', () => {
  it('enqueueScan adds a row visible to listPending', async () => {
    const scan: PendingScan = {
      id: 'scan-1',
      eventId: 'evt-1',
      qrCode: 'tok-abc',
      gate: 'Gate 1',
      scannedAt: new Date('2026-05-25T18:00:00Z').toISOString(),
    }
    await enqueueScan(scan, factory)
    const rows = await listPending(factory)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject(scan)
  })

  it('multiple enqueues all appear in listPending', async () => {
    for (let i = 0; i < 3; i++) {
      await enqueueScan(
        {
          id: `scan-${i}`,
          eventId: 'evt-1',
          qrCode: `tok-${i}`,
          gate: null,
          scannedAt: new Date().toISOString(),
        },
        factory,
      )
    }
    const rows = await listPending(factory)
    expect(rows).toHaveLength(3)
  })

  it('persists across "page reload" — re-opening DB returns same rows', async () => {
    await enqueueScan(
      {
        id: 'persist-1',
        eventId: 'evt-1',
        qrCode: 'tok-persist',
        gate: null,
        scannedAt: new Date().toISOString(),
      },
      factory,
    )
    // Each openDb call inside enqueue/list closes the connection; the
    // store persists. listPending uses a fresh openDb under the hood —
    // simulating reload is the same as just calling listPending again.
    const rows = await listPending(factory)
    expect(rows[0]?.id).toBe('persist-1')
  })

  it('markSyncedAndRemove deletes a specific row; others remain', async () => {
    await enqueueScan({ id: 'a', eventId: 'e', qrCode: 'q', gate: null, scannedAt: 't' }, factory)
    await enqueueScan({ id: 'b', eventId: 'e', qrCode: 'q', gate: null, scannedAt: 't' }, factory)
    await markSyncedAndRemove('a', factory)
    const rows = await listPending(factory)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('b')
  })

  it('newScanId returns a unique-looking string', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) ids.add(newScanId())
    expect(ids.size).toBe(100)
  })
})

// ─── sync orchestrator ──────────────────────────────────────────────

describe('syncCheckinQueue', () => {
  it('empty queue → no-op (idempotent across reloads)', async () => {
    const report = await syncCheckinQueue({ apiBase: 'http://api.test', factory })
    expect(report.attempted).toBe(0)
    expect(report.removed).toBe(0)
    expect(report.retained).toBe(0)
    expect(report.duplicateCount).toBe(0)
  })

  it('one scan + server returns CHECKED_IN → row removed, kind=admitted', async () => {
    await enqueueScan(
      { id: 's1', eventId: 'e1', qrCode: 'q1', gate: null, scannedAt: 't' },
      factory,
    )
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { outcome: 'CHECKED_IN' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch

    const report = await syncCheckinQueue({
      apiBase: 'http://api.test',
      fetcher,
      factory,
    })

    expect(report.attempted).toBe(1)
    expect(report.removed).toBe(1)
    expect(report.rows[0]?.outcome.kind).toBe('admitted')
    expect(await listPending(factory)).toHaveLength(0)
  })

  it('OFFLINE-DOUBLE-ENTRY: two enqueued scans of the same token → first admitted, second duplicate_on_sync; both removed', async () => {
    // Two offline scans of the SAME ticket (two devices both decided
    // OK locally; both enqueued).
    await enqueueScan(
      { id: 'a', eventId: 'e1', qrCode: 'SAME-QR', gate: 'G1', scannedAt: 't' },
      factory,
    )
    await enqueueScan(
      { id: 'b', eventId: 'e1', qrCode: 'SAME-QR', gate: 'G2', scannedAt: 't' },
      factory,
    )

    let callCount = 0
    const fetcher = vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        // First POST: server admits
        return new Response(JSON.stringify({ data: { outcome: 'CHECKED_IN' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      // Second POST: server's compare-and-swap fails → ALREADY
      return new Response(
        JSON.stringify({
          error: {
            code: 'ATTENDEE_ALREADY_CHECKED_IN',
            message: 'already',
            details: { originalCheckInAt: '2026-05-25T18:00:00Z' },
          },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const report = await syncCheckinQueue({
      apiBase: 'http://api.test',
      fetcher,
      factory,
    })

    expect(report.attempted).toBe(2)
    expect(report.removed).toBe(2) // BOTH removed (definitive outcomes)
    expect(report.retained).toBe(0)
    expect(report.duplicateCount).toBe(1) // ops alert!
    const kinds = report.rows.map((r) => r.outcome.kind).sort()
    expect(kinds).toEqual(['admitted', 'duplicate_on_sync'])
    expect(await listPending(factory)).toHaveLength(0)
  })

  it('network error → row retained for retry', async () => {
    await enqueueScan(
      { id: 'retry', eventId: 'e1', qrCode: 'q', gate: null, scannedAt: 't' },
      factory,
    )
    const fetcher = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch

    const report = await syncCheckinQueue({
      apiBase: 'http://api.test',
      fetcher,
      factory,
    })

    expect(report.retained).toBe(1)
    expect(report.removed).toBe(0)
    expect(report.rows[0]?.outcome.kind).toBe('network_error')
    expect(await listPending(factory)).toHaveLength(1) // still queued
  })

  it('invalid / wrong_event / voided are all DEFINITIVE → rows removed', async () => {
    await enqueueScan(
      { id: 'inv', eventId: 'e1', qrCode: 'q1', gate: null, scannedAt: 't' },
      factory,
    )
    await enqueueScan(
      { id: 'we', eventId: 'e1', qrCode: 'q2', gate: null, scannedAt: 't' },
      factory,
    )
    await enqueueScan(
      { id: 'vo', eventId: 'e1', qrCode: 'q3', gate: null, scannedAt: 't' },
      factory,
    )

    const responses: Array<{ status: number; code: string }> = [
      { status: 404, code: 'TICKET_INVALID' },
      { status: 409, code: 'TICKET_WRONG_EVENT' },
      { status: 404, code: 'TICKET_VOIDED' },
    ]
    let i = 0
    const fetcher = vi.fn(async () => {
      const r = responses[i++]!
      return new Response(JSON.stringify({ error: { code: r.code, message: 'x' } }), {
        status: r.status,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const report = await syncCheckinQueue({
      apiBase: 'http://api.test',
      fetcher,
      factory,
    })

    expect(report.attempted).toBe(3)
    expect(report.removed).toBe(3)
    expect(report.retained).toBe(0)
    expect(report.duplicateCount).toBe(0)
    expect(await listPending(factory)).toHaveLength(0)
    const kinds = report.rows.map((r) => r.outcome.kind).sort()
    expect(kinds).toEqual(['invalid', 'voided', 'wrong_event'])
  })

  it('idempotency: re-syncing after a clean flush is a no-op', async () => {
    await enqueueScan(
      { id: 'one', eventId: 'e1', qrCode: 'q', gate: null, scannedAt: 't' },
      factory,
    )
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { outcome: 'CHECKED_IN' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch

    await syncCheckinQueue({ apiBase: 'http://api.test', fetcher, factory })
    const second = await syncCheckinQueue({
      apiBase: 'http://api.test',
      fetcher,
      factory,
    })
    expect(second.attempted).toBe(0)
    expect(fetcher).toHaveBeenCalledTimes(1) // not re-POSTed
  })

  it('partial sync: 2 succeed + 1 errors → 2 removed, 1 retained', async () => {
    await enqueueScan({ id: 'a', eventId: 'e1', qrCode: 'q1', gate: null, scannedAt: 't' }, factory)
    await enqueueScan({ id: 'b', eventId: 'e1', qrCode: 'q2', gate: null, scannedAt: 't' }, factory)
    await enqueueScan({ id: 'c', eventId: 'e1', qrCode: 'q3', gate: null, scannedAt: 't' }, factory)

    let n = 0
    const fetcher = vi.fn(async () => {
      n++
      if (n === 2) throw new Error('blip')
      return new Response(JSON.stringify({ data: { outcome: 'CHECKED_IN' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const report = await syncCheckinQueue({
      apiBase: 'http://api.test',
      fetcher,
      factory,
    })

    expect(report.attempted).toBe(3)
    expect(report.removed).toBe(2)
    expect(report.retained).toBe(1)
    expect(await listPending(factory)).toHaveLength(1) // b stays
  })
})

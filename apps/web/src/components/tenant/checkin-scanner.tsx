'use client'

/**
 * Check-in scanner — Sprint 4 Day 31 Phase 2.
 *
 * Tenant-staff-facing browser QR scanner. Uses `getUserMedia` for the
 * camera + `qr-scanner` for decoding. Falls back to manual code entry
 * when camera is denied / unavailable.
 *
 * ════════════════════════════════════════════════════════════════════
 * UX states (the door display)
 * ════════════════════════════════════════════════════════════════════
 *
 *   - idle / scanning — camera frame; "point at the QR"
 *   - submitting — spinner over the last decoded value
 *   - VALID — big green; attendee name + tier (door admits)
 *   - ALREADY_CHECKED_IN — big amber; attendee name + original time
 *     + gate (door REFUSES re-entry; staff sees the duplicate; this
 *     is the door-correctness display per Phase 1's contract)
 *   - WRONG_EVENT — big red; "wrong event"
 *   - INVALID — big red; voided / not-found
 *   - network_error — big grey; "scan didn't reach server" (Phase 3
 *     will queue these; Phase 2 surfaces directly to the door)
 *
 * After any result, a brief pause (2.5s) then return to scanning so
 * the line keeps moving.
 *
 * ════════════════════════════════════════════════════════════════════
 * Camera-permission fallback
 * ════════════════════════════════════════════════════════════════════
 *
 *   - Camera denied → toggle to "manual entry" mode: a `<input>` +
 *     "Scan" button. Same backend call; same result display.
 *   - No camera at all (no `getUserMedia`) → manual entry only;
 *     surface a notice.
 *
 * ════════════════════════════════════════════════════════════════════
 * QR token format note
 * ════════════════════════════════════════════════════════════════════
 *
 * Per Day 28 (`qr-image.ts buildScanUrl`), the QR encodes a URL like
 * `${API_BASE}/scan/{token}`. The scanner extracts the trailing
 * token segment before submitting. If the QR contains a bare token
 * (manual paste, dev fixture), we accept that too.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { useCheckInStats, useScan, type CheckInOutcome } from '@/hooks/use-checkin'
import { enqueueScan, listPending, newScanId } from '@/lib/offline-checkin-queue'
import { syncCheckinQueue, type SyncReport } from '@/lib/sync-checkin-queue'

// ─── helpers ────────────────────────────────────────────────────────

/**
 * Extract the QR token from either a `${API_BASE}/scan/{token}` URL
 * or a bare token. Exported for tests.
 */
export function extractTokenFromScan(raw: string): string {
  const trimmed = raw.trim()
  // URL form
  const match = trimmed.match(/\/scan\/([A-Za-z0-9_-]+)\/?$/)
  if (match) return match[1]!
  // Bare token form (43-char base64url per Day 28; tolerate the wider band)
  return trimmed
}

// ─── result display ─────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'short',
    })
  } catch {
    return iso
  }
}

interface ResultDisplayProps {
  outcome: CheckInOutcome
}

export function ResultDisplay({ outcome }: ResultDisplayProps) {
  switch (outcome.kind) {
    case 'checked_in':
      return (
        <div
          role="status"
          aria-live="assertive"
          className="rounded-3xl bg-emerald-500 p-8 text-white shadow-2xl"
          data-testid="result-checked-in"
        >
          <div className="text-5xl font-bold uppercase">Admitted</div>
          <div className="mt-4 text-3xl font-semibold">{outcome.attendeeName}</div>
          <div className="mt-2 text-xl opacity-90">{outcome.tierName}</div>
          <div className="mt-4 text-sm opacity-75">
            Checked in {formatDateTime(outcome.checkedInAt)}
          </div>
        </div>
      )
    case 'already_checked_in':
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-3xl bg-amber-500 p-8 text-white shadow-2xl"
          data-testid="result-already"
        >
          <div className="text-5xl font-bold uppercase">Already used</div>
          <div className="mt-4 text-3xl font-semibold">{outcome.attendeeName}</div>
          <div className="mt-2 text-xl opacity-90">{outcome.tierName}</div>
          <div className="mt-4 text-base">
            First scanned at {formatDateTime(outcome.originalCheckInAt)}
            {outcome.originalGate ? ` (${outcome.originalGate})` : ''}
          </div>
          <div className="mt-4 text-lg font-semibold">Refuse entry.</div>
        </div>
      )
    case 'wrong_event':
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-3xl bg-red-600 p-8 text-white shadow-2xl"
          data-testid="result-wrong-event"
        >
          <div className="text-5xl font-bold uppercase">Wrong event</div>
          <div className="mt-4 text-lg">
            This ticket is for a different event. Send the guest to the right gate.
          </div>
        </div>
      )
    case 'invalid':
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-3xl bg-red-600 p-8 text-white shadow-2xl"
          data-testid="result-invalid"
        >
          <div className="text-5xl font-bold uppercase">Invalid</div>
          <div className="mt-4 text-lg">
            {outcome.reason === 'voided'
              ? 'This ticket has been voided.'
              : 'No ticket found for this code. Check the QR or try manual entry.'}
          </div>
        </div>
      )
    case 'network_error':
      return (
        <div
          role="status"
          aria-live="polite"
          className="rounded-3xl bg-zinc-700 p-8 text-white shadow-2xl"
          data-testid="result-network-error"
        >
          <div className="text-4xl font-bold uppercase">Offline</div>
          <div className="mt-4 text-lg">
            The scan did not reach the server. Try again or use manual entry.
          </div>
          <div className="mt-2 text-sm opacity-75">{outcome.message}</div>
        </div>
      )
  }
}

// ─── manual entry sub-form ──────────────────────────────────────────

interface ManualEntryProps {
  onSubmit: (code: string) => void
  disabled?: boolean
}

export function ManualEntry({ onSubmit, disabled }: ManualEntryProps) {
  const [value, setValue] = useState('')
  return (
    <form
      className="rounded-2xl bg-white/5 p-6"
      onSubmit={(e) => {
        e.preventDefault()
        const code = extractTokenFromScan(value)
        if (code.length >= 8) {
          onSubmit(code)
          setValue('')
        }
      }}
    >
      <label htmlFor="manual-qr" className="mb-2 block text-sm font-medium">
        Manual entry
      </label>
      <div className="flex gap-2">
        <input
          id="manual-qr"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste or type the ticket code"
          className="flex-1 rounded-lg border border-white/10 bg-zinc-900/60 px-3 py-2 text-white"
          disabled={disabled}
          data-testid="manual-qr-input"
        />
        <button
          type="submit"
          disabled={disabled || value.trim().length < 8}
          className="rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white disabled:opacity-40"
          data-testid="manual-qr-submit"
        >
          Scan
        </button>
      </div>
    </form>
  )
}

// ─── stats strip ────────────────────────────────────────────────────

function StatsStrip({ eventId }: { eventId: string }) {
  const { data } = useCheckInStats(eventId)
  const total = data?.totalAttendees ?? 0
  const inCount = data?.checkedInCount ?? 0
  const voided = data?.voidedCount ?? 0
  const pct = total > 0 ? Math.round((inCount / total) * 100) : 0
  return (
    <div
      className="grid grid-cols-3 gap-4 rounded-2xl bg-white/5 p-4 text-center"
      data-testid="stats-strip"
    >
      <div>
        <div className="text-3xl font-bold">{inCount}</div>
        <div className="text-xs uppercase opacity-70">Checked in</div>
      </div>
      <div>
        <div className="text-3xl font-bold">
          {total} <span className="text-base opacity-70">({pct}%)</span>
        </div>
        <div className="text-xs uppercase opacity-70">Total</div>
      </div>
      <div>
        <div className="text-3xl font-bold">{voided}</div>
        <div className="text-xs uppercase opacity-70">Voided</div>
      </div>
    </div>
  )
}

// ─── main component ─────────────────────────────────────────────────

export interface CheckInScannerProps {
  eventId: string
  gate?: string
  /** For tests — inject a scan handler that fires immediately. */
  testDecoder?: (input: string) => void
}

const RESULT_DISPLAY_MS = 2500

export function CheckInScanner({ eventId, gate }: CheckInScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerRef = useRef<{ stop: () => void; destroy: () => void } | null>(null)
  const [cameraStatus, setCameraStatus] = useState<
    'idle' | 'starting' | 'on' | 'denied' | 'unsupported'
  >('idle')
  const [lastOutcome, setLastOutcome] = useState<CheckInOutcome | null>(null)
  const [offlineTentative, setOfflineTentative] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [lastSyncDuplicates, setLastSyncDuplicates] = useState(0)
  const scan = useScan()
  // Lock submission while the result is on-screen so a re-decode of the
  // same QR doesn't fire repeatedly while the user is still admitting.
  const lockUntilRef = useRef<number>(0)

  // Refresh the pending-queue count display. Called after enqueue +
  // after sync.
  const refreshPendingCount = useCallback(async () => {
    const rows = await listPending().catch(() => [])
    setPendingCount(rows.length)
  }, [])

  useEffect(() => {
    void refreshPendingCount()
  }, [refreshPendingCount])

  const submitToken = useCallback(
    (token: string) => {
      const now = Date.now()
      if (now < lockUntilRef.current) return
      lockUntilRef.current = now + RESULT_DISPLAY_MS
      scan.mutate(
        { eventId, qrCode: token, gate: gate ?? null },
        {
          onSettled: (outcome) => {
            if (!outcome) return
            // Day 31 Phase 3: optimistic-admit on network error.
            // The door admits the guest immediately + we queue the
            // scan to IndexedDB for sync on reconnect. The UI flags
            // the result as TENTATIVE so staff knows the state is
            // unsynced.
            if (outcome.kind === 'network_error') {
              setOfflineTentative(true)
              void enqueueScan({
                id: newScanId(),
                eventId,
                qrCode: token,
                gate: gate ?? null,
                scannedAt: new Date().toISOString(),
              })
                .then(() => refreshPendingCount())
                .catch(() => {
                  // IndexedDB unavailable (private browsing / disk
                  // full). Door staff still sees the network_error
                  // banner; the queue just doesn't persist.
                })
              // Surface as ADMITTED (offline-tentative) — see
              // decisions.md "Day 31 — Optimistic-admit offline".
              setLastOutcome({
                kind: 'checked_in',
                attendeeId: '',
                attendeeName: '(unknown — offline)',
                tierName: '',
                checkedInAt: new Date().toISOString(),
              })
            } else {
              setOfflineTentative(false)
              setLastOutcome(outcome)
            }
            setTimeout(() => {
              setLastOutcome((current) => (Date.now() >= lockUntilRef.current ? null : current))
            }, RESULT_DISPLAY_MS)
          },
        },
      )
    },
    [eventId, gate, scan, refreshPendingCount],
  )

  // Sync the offline queue on mount + whenever the browser regains
  // connectivity. The server's compare-and-swap (Day 31 Phase 1) is
  // the FINAL authority; duplicate-on-sync rows are surfaced via
  // the lastSyncDuplicates banner.
  useEffect(() => {
    const apiBase = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? ''
    const flush = async () => {
      const report: SyncReport = await syncCheckinQueue({
        apiBase: apiBase.replace(/\/$/, ''),
      }).catch(
        () =>
          ({
            attempted: 0,
            removed: 0,
            retained: 0,
            duplicateCount: 0,
            rows: [],
          }) as SyncReport,
      )
      if (report.duplicateCount > 0) {
        setLastSyncDuplicates(report.duplicateCount)
      }
      await refreshPendingCount()
    }
    void flush() // try once on mount
    const onOnline = () => void flush()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [refreshPendingCount])

  // Camera lifecycle. We dynamic-import `qr-scanner` so the SSR build
  // doesn't pull `navigator.mediaDevices` at compile time.
  useEffect(() => {
    let cancelled = false
    let scannerInstance: { stop: () => void; destroy: () => void } | null = null

    async function start() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
        setCameraStatus('unsupported')
        return
      }
      setCameraStatus('starting')
      try {
        const QrScanner = (await import('qr-scanner')).default
        if (cancelled || !videoRef.current) return
        const inst = new QrScanner(
          videoRef.current,
          (result: { data: string }) => {
            submitToken(extractTokenFromScan(result.data))
          },
          { highlightScanRegion: true, highlightCodeOutline: true },
        )
        await inst.start()
        if (cancelled) {
          inst.destroy()
          return
        }
        scannerInstance = inst
        scannerRef.current = inst
        setCameraStatus('on')
      } catch (err) {
        // NotAllowedError / NotFoundError / etc.
        if (!cancelled) setCameraStatus('denied')
        // eslint-disable-next-line no-console
        console.warn('camera init failed', err)
      }
    }
    void start()
    return () => {
      cancelled = true
      if (scannerInstance) {
        scannerInstance.stop()
        scannerInstance.destroy()
      }
    }
  }, [submitToken])

  return (
    <div className="space-y-6">
      <StatsStrip eventId={eventId} />

      {/* Offline-status banner (Phase 3). Visible whenever there are
         pending offline scans OR the last sync hit a duplicate. */}
      {pendingCount > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl bg-amber-500/90 p-4 text-white"
          data-testid="offline-pending-banner"
        >
          <strong className="text-lg">
            {pendingCount} pending offline scan{pendingCount === 1 ? '' : 's'}
          </strong>
          <p className="text-sm opacity-95">
            Tentative admits are queued. They will sync to the server when connectivity returns. The
            server resolves duplicates if the same ticket was scanned offline elsewhere.
          </p>
        </div>
      )}
      {lastSyncDuplicates > 0 && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-2xl bg-red-600/90 p-4 text-white"
          data-testid="offline-duplicate-banner"
        >
          <strong className="text-lg">
            {lastSyncDuplicates} duplicate {lastSyncDuplicates === 1 ? 'scan' : 'scans'} flagged on
            sync
          </strong>
          <p className="text-sm opacity-95">
            One or more offline-admitted tickets had already been used elsewhere. Notify ops to
            review.
          </p>
        </div>
      )}
      {offlineTentative && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl bg-zinc-700 p-3 text-center text-sm text-white"
          data-testid="offline-tentative-banner"
        >
          Last admit was OFFLINE (tentative). Will sync when connectivity returns.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Camera / fallback */}
        <div className="space-y-3">
          {cameraStatus === 'on' || cameraStatus === 'starting' ? (
            <>
              <video
                ref={videoRef}
                aria-label="QR code camera"
                className="w-full rounded-2xl bg-black"
                playsInline
                muted
                data-testid="camera-video"
              />
              {cameraStatus === 'starting' && (
                <p className="text-center text-sm opacity-70" role="status">
                  Starting camera…
                </p>
              )}
            </>
          ) : (
            <div className="rounded-2xl bg-white/5 p-6 text-center" data-testid="camera-fallback">
              <p className="text-base">
                {cameraStatus === 'denied'
                  ? 'Camera access denied. Use manual entry below.'
                  : 'Camera unavailable. Use manual entry below.'}
              </p>
            </div>
          )}
          <ManualEntry onSubmit={submitToken} disabled={scan.isPending} />
        </div>

        {/* Result panel */}
        <div className="space-y-3" data-testid="result-panel">
          {scan.isPending ? (
            <div
              className="rounded-3xl bg-zinc-700 p-8 text-white"
              role="status"
              data-testid="result-submitting"
            >
              <div className="text-3xl font-bold uppercase">Checking…</div>
            </div>
          ) : lastOutcome ? (
            <ResultDisplay outcome={lastOutcome} />
          ) : (
            <div
              className="rounded-3xl bg-white/5 p-8 text-white opacity-60"
              role="status"
              data-testid="result-idle"
            >
              <div className="text-2xl font-semibold uppercase">Ready</div>
              <div className="mt-2 text-base">Scan a ticket QR code.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

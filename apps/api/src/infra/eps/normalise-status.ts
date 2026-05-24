/**
 * EPS status normalisation — single source of truth per CLAUDE.md §11.4
 * gotcha. EPS V5 responses can use any of several alias permutations
 * across several field locations to convey the same logical status.
 * Centralising the collapse here means downstream order-state code
 * never has to remember which alias maps to which canonical value.
 *
 * The aliases observed in real EPS traffic / docs:
 *
 *   - SUCCESS, COMPLETED   → 'success'    (paid, settled)
 *   - FAILED, FAILURE      → 'failed'     (declined, errored)
 *   - CANCEL, CANCELLED,   → 'cancelled'  (user-cancelled at gateway)
 *     CANCELED
 *   - PENDING              → 'pending'    (awaiting verification)
 *
 * Field locations observed (any of these can carry the status):
 *
 *   - top-level `Status`
 *   - top-level `transactionStatus`
 *   - top-level `status`
 *   - nested `data.Status`
 *   - nested `data.transactionStatus`
 *   - nested `data.status`
 *
 * Lookup priority is deterministic: top-level wins over nested; field
 * names are checked in the order `Status` → `transactionStatus` →
 * `status`. Unknown aliases, missing fields, and non-string values all
 * collapse to `'unknown'` — the caller decides whether to retry,
 * escalate, or log. Throwing here would surface in the order-state
 * machine at confusing times; explicit unknown is the safer return.
 *
 * Case insensitivity: EPS responses have used both `SUCCESS` and
 * `Success` historically. Normalisation upper-cases before alias
 * lookup so capitalisation drift doesn't silently degrade to
 * 'unknown'.
 *
 * Pure function; no I/O; deterministic. Day 24-25 Decision N truth
 * gate exercises the success path against real EPS sandbox traffic;
 * this is the parse-side guarantee that we never mis-classify a
 * real response.
 */

/**
 * Canonical status the rest of the codebase reasons against. The
 * order-state machine (Day 26+) maps these to its own transitions;
 * `'unknown'` is the failure-closed default that prevents an unknown
 * EPS response from being silently treated as success.
 */
export type EpsStatus = 'success' | 'failed' | 'cancelled' | 'pending' | 'unknown'

/**
 * Field names checked in order. `Status` comes first because EPS V5
 * documentation surfaces this name most consistently; the others are
 * defensive against observed real-traffic variation.
 */
const STATUS_FIELD_NAMES = ['Status', 'transactionStatus', 'status'] as const

/**
 * Alias → canonical map. UPPERCASE keys because lookup is case-folded
 * before indexing.
 */
const STATUS_ALIAS_MAP: Readonly<Record<string, EpsStatus>> = {
  SUCCESS: 'success',
  COMPLETED: 'success',
  FAILED: 'failed',
  FAILURE: 'failed',
  CANCEL: 'cancelled',
  CANCELLED: 'cancelled',
  CANCELED: 'cancelled',
  PENDING: 'pending',
}

function extractStatusString(response: unknown): string | null {
  if (response == null || typeof response !== 'object') return null
  const obj = response as Record<string, unknown>

  // Top-level lookup wins over nested. Within each level, field-name
  // order is fixed (deterministic resolution when multiple fields
  // exist on the same level).
  for (const name of STATUS_FIELD_NAMES) {
    const value = obj[name]
    if (typeof value === 'string' && value.length > 0) return value
  }

  const data = obj['data']
  if (data != null && typeof data === 'object') {
    const inner = data as Record<string, unknown>
    for (const name of STATUS_FIELD_NAMES) {
      const value = inner[name]
      if (typeof value === 'string' && value.length > 0) return value
    }
  }

  return null
}

/**
 * Collapse an EPS response (top-level or `data`-wrapped, with any of
 * `Status` / `transactionStatus` / `status` field naming) to a
 * canonical {@link EpsStatus}. Unknown shapes → `'unknown'`.
 */
export function normaliseStatus(response: unknown): EpsStatus {
  const raw = extractStatusString(response)
  if (raw === null) return 'unknown'
  return STATUS_ALIAS_MAP[raw.toUpperCase()] ?? 'unknown'
}

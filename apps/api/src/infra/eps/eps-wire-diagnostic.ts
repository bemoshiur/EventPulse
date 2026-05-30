/**
 * Wire-shape diagnostic helper — produces a structured, log-safe description
 * of a value that the EPS wrapper's zod schema rejected.
 *
 * Why this exists: when EPS responds with a body our schema does NOT accept,
 * the wrapper throws `EpsResponseError`. Without a record of WHAT diverged
 * (extra fields? missing required fields? wrong type? null vs string?), the
 * fix is necessarily a guess. This helper feeds the structured-log warn that
 * fires alongside the throw so the operator (or the truth-gate) can see the
 * actual shape and pin the schema empirically.
 *
 * Safe to log in both sandbox and production: EPS responses to GetToken,
 * InitializeEPS, and CheckMerchantTransactionStatus carry merchant/platform
 * metadata — they do not echo buyer PII (per §1.3 R5 + the file headers on
 * each wrapper). The 1000-char cap prevents log bloat from a malformed XL
 * response.
 *
 * Steady-state cost: zero. Schema validation never fails in normal
 * operation; the diagnostic only fires when something is genuinely wrong,
 * at which point it is exactly the information we want.
 */

/** Structured description of a value's shape — log-safe. */
export interface WireShapeDescription {
  /**
   * One of `'null'`, `'undefined'`, `'array'`, `'object'`, `'string'`,
   * `'number'`, `'boolean'`, `'bigint'`, `'symbol'`, `'function'`. Tells the
   * reader at a glance whether the body was JSON-parsed into the expected
   * `object` or something else (a stray string, an array wrapper).
   */
  kind: string
  /** Top-level keys when `kind === 'object'`; absent otherwise. */
  topLevelKeys?: string[]
  /**
   * Per-key type when `kind === 'object'`. Distinguishes `null` from a string
   * called `"null"`, helps spot `ErrorCode: null` vs `ErrorCode: ""`, etc.
   */
  topLevelTypes?: Record<string, string>
  /**
   * JSON-stringified body, truncated to {@link DEFAULT_MAX_LEN} chars. Absent
   * when the value cannot be safely serialised (circular reference, BigInt
   * inside a v1 stringify, etc.).
   */
  bodyTruncated?: string
}

const DEFAULT_MAX_LEN = 1000

/**
 * One-of-many primitive kinds. Mirrors `typeof` with the JS extensions
 * `array` and `null`. Pure.
 */
function kindOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * Describe a value's shape for diagnostic logging. NEVER throws; on failure
 * to serialise it returns a safe fallback so the upstream log line still
 * emits something useful.
 */
export function describeResponseShape(
  data: unknown,
  maxLen: number = DEFAULT_MAX_LEN,
): WireShapeDescription {
  const kind = kindOf(data)

  let topLevelKeys: string[] | undefined
  let topLevelTypes: Record<string, string> | undefined
  if (kind === 'object') {
    const obj = data as Record<string, unknown>
    topLevelKeys = Object.keys(obj)
    topLevelTypes = {}
    for (const k of topLevelKeys) {
      topLevelTypes[k] = kindOf(obj[k])
    }
  }

  let bodyTruncated: string | undefined
  try {
    const s = JSON.stringify(data)
    if (typeof s === 'string') {
      bodyTruncated = s.length > maxLen ? s.slice(0, maxLen) + '...[truncated]' : s
    }
  } catch {
    // Circular ref, BigInt (in older Node), etc. Leave bodyTruncated undefined;
    // the kind/keys/types fields still describe the shape.
  }

  return { kind, topLevelKeys, topLevelTypes, bodyTruncated }
}

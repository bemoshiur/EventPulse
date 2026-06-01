/**
 * AWS SNS HTTPS notification signature verification — Day 39 Phase 4.
 *
 * Per AWS SNS docs, every SubscriptionConfirmation / Notification /
 * UnsubscribeConfirmation request is signed:
 *
 *   - `SigningCertURL` field on the payload points to an X.509 cert
 *     hosted on `sns.<region>.amazonaws.com`
 *   - `Signature` field is base64(RSA-sign-with-cert's-private-key(canonical))
 *   - The canonical string is built deterministically from a fixed
 *     set of fields in lexicographic order, terminated with `\n`
 *
 * The verifier MUST:
 *   1. Reject any SigningCertURL whose host is not
 *      `sns.<region>.amazonaws.com` (otherwise an attacker hosts
 *       their own cert + signs forged messages)
 *   2. Fetch the cert (cached for performance)
 *   3. Compute the canonical string per the message Type's field list
 *   4. Verify the signature with the cert's public key
 *
 * `SignatureVersion` field is `1` for SHA1-RSA (legacy; rejected here)
 * or `2` for SHA256-RSA. We only accept version 2 per current AWS
 * recommendation.
 *
 * **Security boundary:** the whole anti-forgery story rests on (1) +
 * (2). If the SigningCertURL is not narrowly host-validated, attackers
 * substitute their own cert. The fetched cert is then trusted to
 * verify the message; if the substitution succeeds, no further check
 * helps.
 *
 * **Caching:** certs are valid for ~30 days (AWS rotation cadence)
 * and at the URL level (URL → cert is stable for that URL's lifetime).
 * In-memory Map cache with a max size to bound memory. No cross-process
 * cache; each Node process fetches independently which is fine at our
 * scale.
 */

import { createVerify, X509Certificate } from 'crypto'

/**
 * In-memory cert cache. Key: SigningCertURL string. Bounded; oldest
 * evicted when MAX_CACHE_SIZE reached.
 */
const certCache = new Map<string, { cert: X509Certificate; fetchedAt: number }>()
const MAX_CACHE_SIZE = 16
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

/**
 * Allowed cert-host pattern. AWS docs: cert is hosted on
 * sns.<region>.amazonaws.com. Region segment is any alphanumeric-with-
 * dashes. Subdomain MUST be exactly "sns"; this blocks attackers from
 * registering e.g. "sns.attacker.amazonaws.com" or "sns-evil...".
 */
const ALLOWED_HOST_RE = /^sns\.[a-z0-9-]+\.amazonaws\.com$/

export interface SnsMessage {
  Type: 'SubscriptionConfirmation' | 'Notification' | 'UnsubscribeConfirmation'
  MessageId: string
  Token?: string
  TopicArn: string
  Subject?: string
  Message: string
  Timestamp: string
  SignatureVersion: string
  Signature: string
  SigningCertURL: string
  SubscribeURL?: string
  UnsubscribeURL?: string
  MessageAttributes?: unknown
}

export type VerifyResult =
  | { kind: 'verified' }
  | { kind: 'bad_signature_version'; got: string }
  | { kind: 'bad_cert_host'; got: string }
  | { kind: 'cert_fetch_failed'; reason: string }
  | { kind: 'signature_mismatch' }
  | { kind: 'malformed_message'; reason: string }
  | { kind: 'topic_not_allowed'; got: string }
  | { kind: 'bad_timestamp'; skewSeconds: number }

/**
 * Maximum allowable clock skew between `msg.Timestamp` and now, in
 * seconds. Messages older than this are rejected as potential replays.
 * AWS SNS delivers in seconds; one hour is generous + tolerates
 * webhook downtime within that window. Use the same window for both
 * past + future skew (clock-skew-on-our-side defence).
 */
const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 60

/**
 * Build the canonical string AWS signs. Field list depends on Type;
 * fields are concatenated as `\nkey\nvalue` with the trailing `\n`.
 *
 * SubscriptionConfirmation + UnsubscribeConfirmation:
 *   Message, MessageId, SubscribeURL, Timestamp, Token, TopicArn, Type
 *
 * Notification:
 *   Message, MessageId, Subject (optional, only when present), Timestamp, TopicArn, Type
 */
function buildCanonicalString(msg: SnsMessage): string | { error: string } {
  if (msg.Type === 'Notification') {
    const parts: string[] = ['Message', msg.Message, 'MessageId', msg.MessageId]
    if (msg.Subject !== undefined && msg.Subject !== null) {
      parts.push('Subject', msg.Subject)
    }
    parts.push('Timestamp', msg.Timestamp, 'TopicArn', msg.TopicArn, 'Type', msg.Type)
    return parts.join('\n') + '\n'
  }
  if (msg.Type === 'SubscriptionConfirmation' || msg.Type === 'UnsubscribeConfirmation') {
    if (!msg.SubscribeURL || !msg.Token) {
      return { error: `${msg.Type} missing SubscribeURL or Token` }
    }
    const parts = [
      'Message',
      msg.Message,
      'MessageId',
      msg.MessageId,
      'SubscribeURL',
      msg.SubscribeURL,
      'Timestamp',
      msg.Timestamp,
      'Token',
      msg.Token,
      'TopicArn',
      msg.TopicArn,
      'Type',
      msg.Type,
    ]
    return parts.join('\n') + '\n'
  }
  return { error: `unknown Type: ${(msg as { Type: string }).Type}` }
}

function isAllowedHost(certUrl: string): boolean {
  try {
    const u = new URL(certUrl)
    if (u.protocol !== 'https:') return false
    return ALLOWED_HOST_RE.test(u.hostname.toLowerCase())
  } catch {
    return false
  }
}

async function fetchCert(certUrl: string, deps: VerifyDeps): Promise<X509Certificate | null> {
  const now = Date.now()
  const cached = certCache.get(certUrl)
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.cert
  }

  let body: string
  try {
    body = await deps.fetchText(certUrl)
  } catch {
    return null
  }
  let cert: X509Certificate
  try {
    cert = new X509Certificate(body)
  } catch {
    return null
  }

  if (certCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = certCache.keys().next().value
    if (oldestKey !== undefined) certCache.delete(oldestKey)
  }
  certCache.set(certUrl, { cert, fetchedAt: now })
  return cert
}

export interface VerifyDeps {
  /** Injected text-fetcher for the cert URL (tests can mock). */
  fetchText(url: string): Promise<string>
  /** Injected wall-clock for the freshness check (tests can mock for deterministic skew tests). Defaults to Date.now. */
  nowMs?: () => number
}

export interface VerifyOptions {
  /**
   * Allowlist of expected SNS TopicArns. Provided messages from any
   * other topic are rejected (`topic_not_allowed`) BEFORE signature
   * verification + before any side effect — even SubscriptionConfirmation
   * auto-confirm. Without this, an attacker with their own AWS account
   * could send legitimately-signed SNS messages from their own topics
   * (the signature would verify because it's a real AWS-issued
   * signature) and either onboard their topic via auto-confirm + then
   * spray suppression-list entries, or directly spray suppression-list
   * entries via Notification.
   *
   * Pass an empty list to fail-closed on ALL messages — useful before
   * the AWS-side wiring lands.
   */
  allowedTopicArns?: string[]
}

const defaultDeps: VerifyDeps = {
  async fetchText(url: string): Promise<string> {
    const res = await fetch(url, { method: 'GET' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  },
}

/**
 * Verify an SNS message signature + topic-allowlist + freshness.
 * Returns a discriminated result indicating which check (if any)
 * failed. Caller MUST treat any non-'verified' result as a hard reject.
 *
 * **Check order (load-bearing):** TopicArn allowlist runs FIRST,
 * BEFORE signature verification + before any cert fetch + before any
 * SubscribeURL processing. This is the load-bearing anti-forgery
 * check at the trust-source level — a signature verifies that AWS
 * SNS signed the message, NOT that we expected to receive it. Without
 * the allowlist, attackers with their own AWS account could send
 * legitimately-signed messages from their own topics + use auto-
 * confirm to onboard them or directly spray suppression entries.
 *
 * If `options.allowedTopicArns` is undefined, the trust-source check
 * is SKIPPED. If it's an empty array, ALL messages are rejected
 * (fail-closed before AWS-side wiring lands). If non-empty, only
 * exact TopicArn matches pass.
 */
export async function verifySnsSignature(
  msg: SnsMessage,
  deps: VerifyDeps = defaultDeps,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  // 1. Trust-source check FIRST. Even SubscriptionConfirmation must
  //    come from a topic we explicitly trust; otherwise auto-confirm
  //    becomes the onboarding vector for attacker topics.
  if (options.allowedTopicArns !== undefined) {
    if (!options.allowedTopicArns.includes(msg.TopicArn)) {
      return { kind: 'topic_not_allowed', got: msg.TopicArn }
    }
  }

  if (msg.SignatureVersion !== '2') {
    return { kind: 'bad_signature_version', got: msg.SignatureVersion }
  }
  if (!isAllowedHost(msg.SigningCertURL)) {
    return { kind: 'bad_cert_host', got: msg.SigningCertURL }
  }

  // 2. Freshness check — reject messages whose Timestamp is more
  //    than MAX_TIMESTAMP_SKEW_SECONDS away from now in either
  //    direction. Defends against replay of old signed messages.
  const now = (deps.nowMs ?? Date.now)()
  const msgTimeMs = Date.parse(msg.Timestamp)
  if (Number.isNaN(msgTimeMs)) {
    return { kind: 'malformed_message', reason: `unparseable Timestamp: ${msg.Timestamp}` }
  }
  const skewSeconds = Math.abs(now - msgTimeMs) / 1000
  if (skewSeconds > MAX_TIMESTAMP_SKEW_SECONDS) {
    return { kind: 'bad_timestamp', skewSeconds }
  }

  const canonical = buildCanonicalString(msg)
  if (typeof canonical !== 'string') {
    return { kind: 'malformed_message', reason: canonical.error }
  }
  const cert = await fetchCert(msg.SigningCertURL, deps)
  if (!cert) {
    return { kind: 'cert_fetch_failed', reason: 'unable to fetch or parse cert' }
  }

  const verifier = createVerify('RSA-SHA256')
  verifier.update(canonical, 'utf8')
  let signatureBytes: Buffer
  try {
    signatureBytes = Buffer.from(msg.Signature, 'base64')
  } catch {
    return { kind: 'signature_mismatch' }
  }
  const ok = verifier.verify(cert.publicKey, signatureBytes)
  if (!ok) return { kind: 'signature_mismatch' }

  return { kind: 'verified' }
}

/**
 * Validate that a SubscribeURL / UnsubscribeURL points to an
 * `sns.<region>.amazonaws.com` host. Defence-in-depth: even if
 * signature verification passes + topic is allowlisted, never fetch
 * a URL whose host isn't AWS SNS. This blocks SSRF + attacker-
 * controlled-side-channel patterns.
 */
export function isSafeSnsActionUrl(url: string): boolean {
  return isAllowedHost(url)
}

/** Test helper — clears the in-process cert cache. */
export function _resetSnsCertCache(): void {
  certCache.clear()
}

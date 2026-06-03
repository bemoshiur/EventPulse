/**
 * Magic-link consume-URL builder — browser-auth integration (Day 46, step 6).
 *
 * The emailed link must land on the SAME portal the user signed in from so the
 * cookie is set on the right host. We use the request Origin for that — but only
 * when it is allow-listed (otherwise the API could be coaxed into emailing a
 * link pointing at an attacker's host). The intended audience travels in the
 * link; it is NOT a secret — the #267 grant check at consume is the authority.
 */

export interface ConsumeUrlParts {
  base: string
  token: string
  purpose: string
  audience: string
}

/** Pick the consume base: the request Origin if allow-listed, else the fallback. */
export function resolveConsumeBase(
  originHeader: string | undefined,
  allowlist: string[],
  fallback: string,
): string {
  if (originHeader && allowlist.includes(originHeader)) return originHeader
  return fallback
}

/** Build the `/auth/magic` consume URL with url-encoded query params. */
export function buildConsumeUrl(parts: ConsumeUrlParts): string {
  const q = new URLSearchParams({
    token: parts.token,
    purpose: parts.purpose,
    audience: parts.audience,
  })
  return `${parts.base}/auth/magic?${q.toString()}`
}

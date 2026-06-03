/**
 * Session cookie — browser-auth integration (Day 46, Option B).
 *
 * The browser holds the opaque session token in an HttpOnly cookie; the API
 * middleware reads it and resolves it via `resolveSession` (a live `sessions`
 * row check — strictly better than the Bearer path's "accept any valid JWT").
 *
 * Attributes:
 * - HttpOnly  — JS can't read it (XSS-exfiltration safe; §5.3 intent).
 * - Secure    — HTTPS only (prod is HTTPS-only; set EVENTPULSE_COOKIE_INSECURE=1 for local http).
 * - SameSite=Lax — app/admin/my → api are SAME-site (registrable domain eventpulse.com.bd),
 *   so Lax cookies are sent on those cross-subdomain XHRs while still blocking cross-site.
 * - Domain    — set EVENTPULSE_COOKIE_DOMAIN=eventpulse.com.bd in shared-subdomain envs so
 *   one cookie covers app/admin/my/api; unset in local/test → host-only cookie.
 */

import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Context } from 'hono'

export const SESSION_COOKIE_NAME = 'ep_session'

function cookieDomain(): string | undefined {
  const domain = process.env['EVENTPULSE_COOKIE_DOMAIN']
  return domain && domain.length > 0 ? domain : undefined
}

function cookieSecure(): boolean {
  // Secure by default (prod); opt out only for local http dev.
  return process.env['EVENTPULSE_COOKIE_INSECURE'] !== '1'
}

/** Set the session cookie to the given opaque token, expiring with the session. */
export function setSessionCookie(c: Context, token: string, expiresAt: Date): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'Lax',
    path: '/',
    domain: cookieDomain(),
    expires: expiresAt,
  })
}

/** Clear the session cookie (logout). Must match the set attributes for the delete to take. */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
    domain: cookieDomain(),
    secure: cookieSecure(),
  })
}

/** Read the opaque session token from the request cookie, if present. */
export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME)
}

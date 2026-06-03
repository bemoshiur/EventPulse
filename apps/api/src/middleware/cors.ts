/**
 * App-wide CORS for the browser-auth integration (Day 46, Option B —
 * session-cookie transport). See docs/design/browser-auth-integration.md §3.1.
 *
 * The portals (app/admin/my.eventpulse.com.bd) call the API cross-origin with
 * `credentials: 'include'`. The Fetch spec forbids `Access-Control-Allow-Origin: *`
 * when credentials are sent, so we **echo only an explicit allow-listed origin**
 * and set `Access-Control-Allow-Credentials: true`. A non-allow-listed origin
 * gets no ACAO at all (the browser then blocks the response).
 */

import { cors } from 'hono/cors'
import type { MiddlewareHandler } from 'hono'

const DEFAULT_PORTAL_ORIGINS = [
  'https://app.eventpulse.com.bd',
  'https://admin.eventpulse.com.bd',
  'https://my.eventpulse.com.bd',
]

/**
 * Allow-listed browser origins. Reads `EVENTPULSE_CORS_ORIGINS` (comma-separated)
 * and falls back to the production portal origins. Set the env per environment
 * (e.g. staging portals + `http://localhost:3000` for local dev).
 */
export function allowedOrigins(): string[] {
  const raw = process.env['EVENTPULSE_CORS_ORIGINS']
  if (!raw) return DEFAULT_PORTAL_ORIGINS
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * App-wide CORS middleware. The allowlist is resolved per-request so env
 * changes (and tests) take effect without re-instantiating the app.
 */
export function corsMiddleware(): MiddlewareHandler {
  return cors({
    origin: (origin) => (origin && allowedOrigins().includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    maxAge: 600,
  })
}

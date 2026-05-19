/**
 * Internal revalidation hook — Sprint 2 Day 19 Item 15 (Decision K).
 *
 * Called by the apps/api Legal & Trust publish endpoint (fire-and-forget)
 * after a new version commits. Invalidates the Next.js cache for the
 * document's `canonical_url_path` so the public page reflects the new
 * content within ~1s instead of waiting for the 1-hour
 * `revalidate: 3600` TTL.
 *
 * Shared-secret auth: matches `WEB_REVALIDATE_SECRET` env var. The
 * matching `WEB_REVALIDATE_URL` env var on the apps/api side points
 * here. Both env vars must be set for the hook to fire; missing
 * either is a no-op (apps/api logs a warn but does not error).
 */

import { revalidatePath } from 'next/cache'
import type { NextRequest } from 'next/server'

interface Body {
  path?: string
  secret?: string
}

export async function POST(request: NextRequest): Promise<Response> {
  const expectedSecret = process.env['WEB_REVALIDATE_SECRET']
  if (!expectedSecret) {
    return Response.json(
      { error: { code: 'NOT_CONFIGURED', message: 'WEB_REVALIDATE_SECRET not set' } },
      { status: 503 },
    )
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return Response.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid JSON body' } },
      { status: 400 },
    )
  }

  if (!body.secret || body.secret !== expectedSecret) {
    return Response.json(
      { error: { code: 'FORBIDDEN', message: 'invalid secret' } },
      { status: 403 },
    )
  }

  if (!body.path || typeof body.path !== 'string' || !body.path.startsWith('/')) {
    return Response.json(
      { error: { code: 'BAD_REQUEST', message: 'path must be a "/" path' } },
      { status: 400 },
    )
  }

  revalidatePath(body.path)
  return Response.json({ data: { revalidated: body.path } })
}

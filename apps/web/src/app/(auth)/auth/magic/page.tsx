'use client'

/**
 * Magic-link consume page — browser-auth integration (Day 46, Option B, step 5).
 *
 * The emailed link lands here (`/auth/magic?token=…&audience=…`). We POST the
 * token to the API consume endpoint with `credentials:'include'` so the API can
 * set the HttpOnly `ep_session` cookie cross-origin (CORS allows credentials for
 * portal origins). On success we hard-navigate to the audience home so the fresh
 * cookie rides the next request. Audience is server-enforced (#267 grant check),
 * so a wrong-portal account surfaces as a 403 here.
 */

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { GlassCard } from '@/components/ui/glass-card'
import { consumeErrorMessage, consumeHomePath } from '@/lib/auth-portal'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

type ConsumeState = { kind: 'loading' } | { kind: 'error'; message: string }

function MagicConsume() {
  const params = useSearchParams()
  const [state, setState] = useState<ConsumeState>({ kind: 'loading' })
  const ran = useRef(false)

  useEffect(() => {
    // Guard against React StrictMode's double-invoke + any re-render: a magic
    // token is single-use, so the consume POST must fire exactly once.
    if (ran.current) return
    ran.current = true

    const token = params.get('token')
    const audience = params.get('audience') ?? 'attendee'
    if (!token) {
      setState({ kind: 'error', message: 'This link is missing its token. Request a new one.' })
      return
    }

    void (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/v1/auth/magic-link/consume`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token, audience }),
        })
        if (res.ok) {
          window.location.assign(consumeHomePath(audience))
          return
        }
        setState({ kind: 'error', message: consumeErrorMessage(res.status) })
      } catch {
        setState({ kind: 'error', message: 'Network error. Please try again.' })
      }
    })()
  }, [params])

  return (
    <GlassCard variant="strong" className="w-full max-w-md rounded-3xl p-8 text-center sm:p-10">
      <h1 className="font-display text-ep-ink text-2xl font-semibold tracking-tight">
        Event Pulse
      </h1>
      {state.kind === 'loading' ? (
        <p className="text-ep-graphite mt-4 text-sm">Signing you in…</p>
      ) : (
        <div className="mt-4">
          <p role="alert" className="text-ep-rose text-sm">
            {state.message}
          </p>
          <Link
            href="/sign-in"
            className="text-ep-violet mt-6 inline-block text-sm font-semibold hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      )}
    </GlassCard>
  )
}

export default function MagicConsumePage() {
  return (
    <Suspense
      fallback={
        <GlassCard variant="strong" className="w-full max-w-md rounded-3xl p-8 text-center sm:p-10">
          <p className="text-ep-graphite text-sm">Loading…</p>
        </GlassCard>
      }
    >
      <MagicConsume />
    </Suspense>
  )
}

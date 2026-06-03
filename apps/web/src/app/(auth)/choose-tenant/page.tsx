'use client'

/**
 * Tenant picker — the post-login "choose a space" screen (§2.3 / §10.3,
 * decisions.md 2026-06-04 "always show a picker").
 *
 * A user who signed in at app.eventpulse.com.bd lands here holding an attendee
 * session. We read `GET /my/contexts` (credentials:'include' so the HttpOnly
 * ep_session cookie rides cross-origin), list the tenants they may act in, and
 * on selection POST `/my/contexts/switch` — which mints a tenant-scoped session
 * (re-checking membership server-side) and swaps the cookie. We then hard-
 * navigate to /dashboard so the new cookie rides the next request.
 *
 * Always shown, even for a single-tenant user. A user with no tenants sees the
 * empty state.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { GlassCard } from '@/components/ui/glass-card'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

type TenantContext = {
  id: string
  name: string
  slug: string
  type: string | null
  isPersonal: boolean
  kycStatus: string
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; contexts: TenantContext[] }

const KYC_LABEL: Record<string, string> = {
  approved: 'Verified',
  submitted: 'KYC in review',
  under_review: 'KYC in review',
  rejected: 'KYC rejected',
  not_submitted: 'No KYC yet',
}

export function ChooseTenant() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [switchingId, setSwitchingId] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/v1/my/contexts`, { credentials: 'include' })
        if (res.status === 401) {
          window.location.assign('/sign-in')
          return
        }
        if (!res.ok) {
          setState({ kind: 'error', message: 'Could not load your spaces. Please try again.' })
          return
        }
        const body = (await res.json()) as { data: { contexts: TenantContext[] } }
        setState({ kind: 'ready', contexts: body.data.contexts })
      } catch {
        setState({ kind: 'error', message: 'Network error. Please try again.' })
      }
    })()
  }, [])

  async function choose(tenantId: string) {
    setSwitchingId(tenantId)
    try {
      const res = await fetch(`${apiBase()}/api/v1/my/contexts/switch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tenantId }),
      })
      if (res.ok) {
        window.location.assign('/dashboard')
        return
      }
      setSwitchingId(null)
      setState({ kind: 'error', message: 'Could not open that space. Please try again.' })
    } catch {
      setSwitchingId(null)
      setState({ kind: 'error', message: 'Network error. Please try again.' })
    }
  }

  return (
    <GlassCard variant="strong" className="w-full max-w-md rounded-3xl p-8 sm:p-10">
      <header className="text-center">
        <h1 className="font-display text-ep-ink text-2xl font-semibold tracking-tight">
          Choose a space
        </h1>
        <p className="text-ep-graphite mt-2 text-sm">
          Pick which organiser account you want to work in.
        </p>
      </header>

      <div className="mt-8">
        {state.kind === 'loading' && (
          <p role="status" className="text-ep-graphite text-center text-sm">
            Loading your spaces…
          </p>
        )}

        {state.kind === 'error' && (
          <div className="text-center">
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

        {state.kind === 'ready' && state.contexts.length === 0 && (
          <div className="text-center">
            <p className="text-ep-graphite text-sm">
              You’re signed in, but you don’t host any events yet.
            </p>
            <Link
              href="/"
              className="bg-ep-violet mt-6 inline-flex h-11 items-center rounded-md px-6 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              Host an event
            </Link>
          </div>
        )}

        {state.kind === 'ready' && state.contexts.length > 0 && (
          <ul className="space-y-3">
            {state.contexts.map((ctx) => (
              <li key={ctx.id}>
                <button
                  type="button"
                  onClick={() => void choose(ctx.id)}
                  disabled={switchingId !== null}
                  className="border-ep-line hover:border-ep-violet flex w-full items-center justify-between rounded-lg border bg-white/60 px-4 py-3 text-left backdrop-blur transition hover:-translate-y-0.5 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="text-ep-ink block truncate text-sm font-semibold">
                      {ctx.name}
                    </span>
                    <span className="text-ep-graphite block truncate text-xs">
                      @{ctx.slug}
                      {ctx.isPersonal ? ' · Personal' : ''} ·{' '}
                      {KYC_LABEL[ctx.kycStatus] ?? ctx.kycStatus}
                    </span>
                  </span>
                  <span className="text-ep-violet ml-3 shrink-0 text-sm" aria-hidden="true">
                    {switchingId === ctx.id ? '…' : '→'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GlassCard>
  )
}

export default function ChooseTenantPage() {
  return <ChooseTenant />
}

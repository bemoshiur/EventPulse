'use client'

/**
 * Client-side auth gate for the protected route groups ((tenant), (admin)).
 *
 * The session cookie is HttpOnly, so the browser can't read it directly — we
 * ask the API who we are via `GET /auth/session` (credentials:'include') and
 * decide:
 *   - not authenticated (401) → redirect to /sign-in
 *   - authenticated as the WRONG audience for this portal → redirect to
 *     `wrongAudiencePath` (the tenant portal sends an attendee — a user who
 *     logged in but hasn't picked a tenant — to /choose-tenant; admin → sign-in)
 *   - authenticated as the right audience → render the protected children
 *
 * Until the check resolves we render a calm loading state, never the protected
 * shell, so unauthenticated users never glimpse it. The (tenant)/(admin) layout
 * persists across in-portal navigations, so this runs once per full page load.
 */

import { useEffect, useState, type ReactNode } from 'react'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

type GateState = 'checking' | 'authed'

export function AuthGate({
  audience,
  wrongAudiencePath = '/sign-in',
  children,
}: {
  audience: 'tenant' | 'super-admin'
  wrongAudiencePath?: string
  children: ReactNode
}) {
  const [state, setState] = useState<GateState>('checking')

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/v1/auth/session`, { credentials: 'include' })
        if (!res.ok) {
          window.location.assign('/sign-in')
          return
        }
        const body = (await res.json()) as { data?: { audience?: string } }
        if (body.data?.audience === audience) {
          setState('authed')
          return
        }
        // Authenticated, but not for this portal.
        window.location.assign(wrongAudiencePath)
      } catch {
        window.location.assign('/sign-in')
      }
    })()
  }, [audience, wrongAudiencePath])

  if (state === 'authed') return <>{children}</>

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <p role="status" className="text-ep-graphite text-sm">
        Signing you in…
      </p>
    </div>
  )
}

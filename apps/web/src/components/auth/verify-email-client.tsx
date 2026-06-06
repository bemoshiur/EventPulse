'use client'

/**
 * Email-confirmation landing — consumes the ?token= from the verification link
 * (POST /api/v1/auth/verify-email/consume), which sets the session cookie and
 * logs the user in. Fires exactly once (the token is single-use).
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { consumeHomePath } from '@/lib/auth-portal'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

type State = { kind: 'loading' } | { kind: 'ok' } | { kind: 'error' }

export function VerifyEmailClient() {
  const token = useSearchParams().get('token')
  const [state, setState] = useState<State>({ kind: 'loading' })
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    if (!token) {
      setState({ kind: 'error' })
      return
    }
    void (async () => {
      try {
        const r = await fetch(`${apiBase()}/api/v1/auth/verify-email/consume`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token }),
        })
        if (r.ok) {
          setState({ kind: 'ok' })
          setTimeout(() => window.location.assign(consumeHomePath('attendee')), 1200)
        } else {
          setState({ kind: 'error' })
        }
      } catch {
        setState({ kind: 'error' })
      }
    })()
  }, [token])

  if (state.kind === 'loading') {
    return <p className="text-mkt-slate text-center text-sm">Confirming your email…</p>
  }
  if (state.kind === 'ok') {
    return (
      <div className="text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-600 text-2xl font-bold text-white">
          ✓
        </div>
        <p className="text-mkt-ink mt-3 font-semibold">Email confirmed</p>
        <p className="text-mkt-slate mt-1 text-sm">Taking you to your dashboard…</p>
      </div>
    )
  }
  return (
    <div className="text-center">
      <div className="bg-mkt-red mx-auto flex size-12 items-center justify-center rounded-full text-2xl font-bold text-white">
        !
      </div>
      <p className="text-mkt-ink mt-3 font-semibold">This link is invalid or expired</p>
      <p className="text-mkt-slate mt-1 text-sm">
        Confirmation links expire after a short time and can only be used once.
      </p>
      <Link
        href="/sign-in"
        className="bg-mkt-red mt-4 inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-semibold text-white"
      >
        Back to sign in
      </Link>
    </div>
  )
}

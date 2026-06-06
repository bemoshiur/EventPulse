'use client'

/**
 * Reset-password — reads ?token= from the email link, takes a new password →
 * POST /api/v1/auth/password/reset. On success the API sets the session cookie
 * and logs the user in.
 */

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, Lock } from 'lucide-react'

import { consumeHomePath } from '@/lib/auth-portal'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

const INPUT =
  'border-mkt-line text-mkt-ink placeholder:text-mkt-slate/50 focus:border-mkt-red h-12 w-full rounded-md border bg-white pr-3 pl-9 text-sm focus:outline-none disabled:opacity-60'

export function ResetPasswordForm() {
  const token = useSearchParams().get('token')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!token) {
    return (
      <div className="text-center">
        <p className="text-mkt-ink font-semibold">This reset link is invalid</p>
        <p className="text-mkt-slate mt-1 text-sm">Request a new one from the sign-in page.</p>
        <Link
          href="/forgot-password"
          className="bg-mkt-red mt-4 inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-semibold text-white"
        >
          Request a new link
        </Link>
      </div>
    )
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch(`${apiBase()}/api/v1/auth/password/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password }),
      })
      if (r.ok) {
        window.location.assign(consumeHomePath('attendee'))
        return
      }
      setError(
        r.status === 401
          ? 'This reset link is invalid or has expired. Request a new one.'
          : 'Something went wrong. Please try again.',
      )
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="relative">
        <Lock className="text-mkt-slate/60 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password (8+ characters)"
          disabled={submitting}
          minLength={8}
          className={INPUT}
        />
      </div>
      {error && (
        <p role="alert" className="text-mkt-red text-xs">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="bg-mkt-red mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Updating…' : 'Set new password'}
        {!submitting && <ArrowRight className="size-4" />}
      </button>
    </form>
  )
}

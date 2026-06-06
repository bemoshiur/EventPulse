'use client'

/**
 * Password sign-up — name + email + password → POST /api/v1/auth/password/signup.
 * The account is created UNVERIFIED and no session is opened; we show a
 * "check your email" state (with resend) until the user confirms. (Onboarding
 * decisions.md 2026-06-06.)
 */

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowRight, Lock, Mail, User } from 'lucide-react'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

const INPUT =
  'border-mkt-line text-mkt-ink placeholder:text-mkt-slate/50 focus:border-mkt-red h-12 w-full rounded-md border bg-white pr-3 pl-9 text-sm focus:outline-none disabled:opacity-60'

export function SignUpForm() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch(`${apiBase()}/api/v1/auth/password/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fullName: fullName.trim(), email: email.trim(), password }),
      })
      if (r.ok) {
        setSent(true)
        return
      }
      const body = await r.json().catch(() => ({}))
      setError(
        r.status === 409
          ? 'An account with this email already exists. Try signing in.'
          : (body?.error?.message ?? 'Something went wrong. Please try again.'),
      )
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function resend() {
    setError(null)
    await fetch(`${apiBase()}/api/v1/auth/verify-email/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => {})
  }

  if (sent) {
    return (
      <div className="border-mkt-line rounded-2xl border bg-white/70 p-5 text-center">
        <div className="bg-mkt-red/10 text-mkt-red mx-auto flex size-12 items-center justify-center rounded-full">
          <Mail className="size-6" />
        </div>
        <p className="text-mkt-ink mt-3 font-semibold">Check your email</p>
        <p className="text-mkt-slate mt-1 text-sm">
          We sent a confirmation link to <span className="text-mkt-ink font-medium">{email}</span>.
          Click it to activate your account, then sign in.
        </p>
        <button
          type="button"
          onClick={resend}
          className="text-mkt-red mt-4 text-xs font-semibold hover:underline"
        >
          Didn’t get it? Resend email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="relative">
        <User className="text-mkt-slate/60 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          type="text"
          required
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Full name"
          disabled={submitting}
          minLength={2}
          className={INPUT}
        />
      </div>
      <div className="relative">
        <Mail className="text-mkt-slate/60 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          disabled={submitting}
          className={INPUT}
        />
      </div>
      <div className="relative">
        <Lock className="text-mkt-slate/60 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Create a password (8+ characters)"
          disabled={submitting}
          minLength={8}
          className={INPUT}
        />
      </div>
      {error && (
        <p role="alert" className="text-mkt-red text-xs">
          {error}{' '}
          {error.includes('already exists') && (
            <Link href="/sign-in" className="font-semibold underline">
              Sign in
            </Link>
          )}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="bg-mkt-red mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Creating account…' : 'Create account'}
        {!submitting && <ArrowRight className="size-4" />}
      </button>
    </form>
  )
}

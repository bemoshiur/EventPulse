'use client'

/**
 * Password sign-in — email + password → POST /api/v1/auth/password/login.
 * On success the API sets the HttpOnly session cookie and we redirect to the
 * portal home. A 403 EMAIL_NOT_VERIFIED surfaces a "resend confirmation"
 * affordance. (Onboarding decisions.md 2026-06-06.)
 */

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowRight, Lock, Mail } from 'lucide-react'

import { consumeHomePath } from '@/lib/auth-portal'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

const INPUT =
  'border-mkt-line text-mkt-ink placeholder:text-mkt-slate/50 focus:border-mkt-red h-12 w-full rounded-md border bg-white pr-3 pl-9 text-sm focus:outline-none disabled:opacity-60'

export function SignInForm({ audience }: { audience?: 'super-admin' | 'attendee' } = {}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [resent, setResent] = useState(false)
  // MFA second-factor step
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setUnverified(false)
    try {
      const r = await fetch(`${apiBase()}/api/v1/auth/password/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: email.trim(),
          password,
          ...(audience ? { audience } : {}),
        }),
      })
      const body = await r.json().catch(() => ({}))
      if (r.ok) {
        if (body?.data?.mfaRequired) {
          setChallengeToken(body.data.challengeToken as string)
          return
        }
        window.location.assign(consumeHomePath(audience ?? 'attendee'))
        return
      }
      if (r.status === 403 && body?.error?.code === 'EMAIL_NOT_VERIFIED') {
        setUnverified(true)
      } else if (r.status === 401) {
        setError('Incorrect email or password.')
      } else {
        setError(body?.error?.message ?? 'Something went wrong. Please try again.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function verifyMfa(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch(`${apiBase()}/api/v1/auth/mfa/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challengeToken, code: mfaCode.trim() }),
      })
      if (r.ok) {
        window.location.assign(consumeHomePath(audience ?? 'attendee'))
        return
      }
      setError('Incorrect or expired code. Try again, or use a recovery code.')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function resend() {
    setResent(true)
    await fetch(`${apiBase()}/api/v1/auth/verify-email/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => {})
  }

  if (challengeToken) {
    return (
      <form onSubmit={verifyMfa} className="flex flex-col gap-3">
        <p className="text-mkt-slate text-sm">
          Enter the 6-digit code from your authenticator app (or a recovery code).
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          value={mfaCode}
          onChange={(e) => setMfaCode(e.target.value)}
          placeholder="123456"
          disabled={submitting}
          className="border-mkt-line text-mkt-ink focus:border-mkt-red h-12 w-full rounded-md border bg-white px-3 text-center text-lg tracking-[0.3em] focus:outline-none"
        />
        {error && (
          <p role="alert" className="text-mkt-red text-xs">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="bg-mkt-red inline-flex h-12 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
        >
          {submitting ? 'Verifying…' : 'Verify'}
        </button>
        <button
          type="button"
          onClick={() => {
            setChallengeToken(null)
            setMfaCode('')
            setError(null)
          }}
          className="text-mkt-slate text-xs hover:underline"
        >
          Back to sign in
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          disabled={submitting}
          className={INPUT}
        />
      </div>

      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-mkt-slate text-xs hover:underline">
          Forgot password?
        </Link>
      </div>

      {error && (
        <p role="alert" className="text-mkt-red text-xs">
          {error}
        </p>
      )}
      {unverified && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Please confirm your email before signing in.{' '}
          {resent ? (
            <span className="font-semibold">Confirmation email sent — check your inbox.</span>
          ) : (
            <button type="button" onClick={resend} className="font-semibold underline">
              Resend confirmation
            </button>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="bg-mkt-red mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
        {!submitting && <ArrowRight className="size-4" />}
      </button>
    </form>
  )
}

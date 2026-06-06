'use client'

/**
 * Forgot-password — email → POST /api/v1/auth/password/forgot. Always shows the
 * same "check your email" state (the endpoint never reveals account existence).
 */

import { useState, type FormEvent } from 'react'
import { ArrowRight, Mail } from 'lucide-react'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

const INPUT =
  'border-mkt-line text-mkt-ink placeholder:text-mkt-slate/50 focus:border-mkt-red h-12 w-full rounded-md border bg-white pr-3 pl-9 text-sm focus:outline-none disabled:opacity-60'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await fetch(`${apiBase()}/api/v1/auth/password/forgot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
    } catch {
      /* show the same state regardless — no enumeration */
    } finally {
      setSubmitting(false)
      setSent(true)
    }
  }

  if (sent) {
    return (
      <div className="border-mkt-line rounded-2xl border bg-white/70 p-5 text-center">
        <div className="bg-mkt-red/10 text-mkt-red mx-auto flex size-12 items-center justify-center rounded-full">
          <Mail className="size-6" />
        </div>
        <p className="text-mkt-ink mt-3 font-semibold">Check your email</p>
        <p className="text-mkt-slate mt-1 text-sm">
          If an account exists for <span className="text-mkt-ink font-medium">{email}</span>, we’ve
          sent a link to reset your password.
        </p>
      </div>
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
      <button
        type="submit"
        disabled={submitting}
        className="bg-mkt-red mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Sending…' : 'Send reset link'}
        {!submitting && <ArrowRight className="size-4" />}
      </button>
    </form>
  )
}

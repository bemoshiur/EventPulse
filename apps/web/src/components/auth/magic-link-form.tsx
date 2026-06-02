'use client'

import { useState, type FormEvent } from 'react'
import { ArrowRight, Mail } from 'lucide-react'

/**
 * Magic-link email form for sign-in / sign-up (§5.2, §19.2).
 *
 * POSTs the email to `/api/v1/auth/magic-link/request`. The endpoint
 * ALWAYS responds 202 to avoid email-enumeration regardless of whether
 * the account exists (see `apps/api/src/routes/auth.ts:137`), so the
 * UI shows "Check your email" identically for any non-network-error
 * response.
 *
 * No idempotency key — magic-link issuance is one-token-per-request
 * by design (no money moves; collisions are benign).
 */
export function MagicLinkForm() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return

    setSubmitting(true)
    setErrorMessage(null)

    try {
      const r = await fetch('/api/v1/auth/magic-link/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: trimmed, purpose: 'signin' }),
      })
      // 2xx (including 202) → success. The endpoint never reveals
      // account existence, so we surface "Check your email" identically.
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        setErrorMessage(body?.error?.message ?? 'Something went wrong. Please try again.')
        return
      }
      setSubmitted(true)
    } catch {
      setErrorMessage('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="border-ep-line rounded-md border bg-white/60 p-4 text-sm">
        <p className="text-ep-ink font-medium">Check your email.</p>
        <p className="text-ep-graphite mt-1">
          We sent a sign-in link to <span className="font-medium">{email}</span>. The link is good
          for 15 minutes.
        </p>
        <button
          type="button"
          onClick={() => {
            setSubmitted(false)
            setErrorMessage(null)
          }}
          className="text-ep-violet mt-3 text-xs font-medium hover:underline"
        >
          Use a different email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1">
        <Mail className="text-ep-graphite/60 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          disabled={submitting}
          className="border-ep-line text-ep-ink placeholder:text-ep-graphite/50 focus:border-ep-cerulean h-12 w-full rounded-md border bg-white pr-3 pl-9 text-sm focus:outline-none disabled:opacity-60"
        />
        {errorMessage && (
          <p role="alert" className="text-ep-rose mt-2 text-xs">
            {errorMessage}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="grad-primary inline-flex h-12 items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Sending…' : 'Continue'}
        <ArrowRight className="h-4 w-4" />
      </button>
    </form>
  )
}

'use client'

import { useState, type FormEvent } from 'react'
import { ArrowRight, Mail } from 'lucide-react'

/**
 * Magic-link email form for sign-in / sign-up (§5.2, §19.2).
 *
 * Day 1-2: client-side only. Submission swaps to the "Check your email" state
 * but does not yet call the API — that wiring lands in Sprint 1 Day 7–8 when
 * the magic_links table and the issuance endpoint exist.
 */
export function MagicLinkForm() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim()) return
    // TODO(Sprint 1 Day 7-8): POST /api/v1/tenant/auth/magic-link with idempotency
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="rounded-md border border-ep-line bg-white/60 p-4 text-sm">
        <p className="font-medium text-ep-ink">Check your email.</p>
        <p className="mt-1 text-ep-graphite">
          We sent a sign-in link to <span className="font-medium">{email}</span>. The link is
          good for 15 minutes.
        </p>
        <button
          type="button"
          onClick={() => setSubmitted(false)}
          className="mt-3 text-xs font-medium text-ep-violet hover:underline"
        >
          Use a different email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1">
        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ep-graphite/60" />
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          className="h-12 w-full rounded-md border border-ep-line bg-white pl-9 pr-3 text-sm text-ep-ink placeholder:text-ep-graphite/50 focus:border-ep-cerulean focus:outline-none"
        />
      </div>
      <button
        type="submit"
        className="inline-flex h-12 items-center justify-center gap-2 rounded-md grad-primary px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
      >
        Continue
        <ArrowRight className="h-4 w-4" />
      </button>
    </form>
  )
}

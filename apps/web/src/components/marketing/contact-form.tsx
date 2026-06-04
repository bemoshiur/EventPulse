'use client'

import { useState } from 'react'

const TOPICS = [
  { value: 'sales', label: 'Sales' },
  { value: 'support', label: 'Support' },
  { value: 'legal', label: 'Legal / Compliance' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'press', label: 'Press' },
  { value: 'security', label: 'Security disclosure' },
  { value: 'other', label: 'Other' },
] as const

type Status = 'idle' | 'submitting' | 'submitted' | 'error' | 'rate_limited'

const inputBase =
  'mt-1 block w-full rounded-md border border-mkt-line bg-white/80 px-3 py-2 text-sm text-mkt-ink backdrop-blur placeholder:text-mkt-slate/60 focus:border-[var(--color-mkt-red)] focus:outline-none focus:ring-2 focus:ring-[var(--color-mkt-red)]/30'

const labelBase = 'text-xs font-semibold text-mkt-ink'

export function ContactForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    const payload: Record<string, string> = {}
    for (const [key, value] of fd.entries()) {
      if (typeof value === 'string' && value.length > 0) payload[key] = value
    }

    setStatus('submitting')
    setErrorMessage(null)

    try {
      const r = await fetch('/api/v1/public/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (r.status === 429) {
        setStatus('rate_limited')
        return
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        setErrorMessage(body?.error?.message ?? 'Something went wrong. Please try again.')
        setStatus('error')
        return
      }
      setStatus('submitted')
      form.reset()
    } catch {
      setErrorMessage('Network error. Please try again.')
      setStatus('error')
    }
  }

  if (status === 'submitted') {
    return (
      <div role="status" className="rounded-lg bg-[var(--emerald-600)]/10 px-6 py-8 text-center">
        <h3 className="text-mkt-ink text-base font-semibold">Message sent.</h3>
        <p className="text-mkt-slate mt-2 text-sm leading-relaxed">
          We&rsquo;ll respond within 24 hours for support, 72 hours for security disclosures. Thank
          you for reaching out.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label htmlFor="name" className={labelBase}>
            Name <span className="text-mkt-red">*</span>
          </label>
          <input id="name" name="name" type="text" required maxLength={120} className={inputBase} />
        </div>
        <div>
          <label htmlFor="email" className={labelBase}>
            Email <span className="text-mkt-red">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            maxLength={254}
            className={inputBase}
          />
        </div>
        <div>
          <label htmlFor="phone" className={labelBase}>
            Phone
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            maxLength={40}
            className={inputBase}
            placeholder="+880..."
          />
        </div>
        <div>
          <label htmlFor="organisation" className={labelBase}>
            Organisation
          </label>
          <input
            id="organisation"
            name="organisation"
            type="text"
            maxLength={200}
            className={inputBase}
          />
        </div>
      </div>

      <div>
        <label htmlFor="topic" className={labelBase}>
          Topic
        </label>
        <select id="topic" name="topic" className={inputBase}>
          <option value="">Choose one (optional)</option>
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="subject" className={labelBase}>
          Subject <span className="text-mkt-red">*</span>
        </label>
        <input
          id="subject"
          name="subject"
          type="text"
          required
          minLength={3}
          maxLength={200}
          className={inputBase}
        />
      </div>

      <div>
        <label htmlFor="message" className={labelBase}>
          Message <span className="text-mkt-red">*</span>
        </label>
        <textarea
          id="message"
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          className={inputBase}
        />
      </div>

      <label htmlFor="website" className="sr-only" aria-hidden="true">
        Website (leave blank)
      </label>
      <input
        id="website"
        name="website"
        type="text"
        autoComplete="off"
        tabIndex={-1}
        aria-hidden="true"
        className="hidden"
      />

      {status === 'rate_limited' && (
        <div
          role="alert"
          className="text-mkt-ink rounded-md bg-[var(--ep-amber)]/10 px-4 py-3 text-sm"
        >
          You&rsquo;ve sent several messages recently. Please wait an hour and try again.
        </div>
      )}
      {status === 'error' && errorMessage && (
        <div
          role="alert"
          className="text-mkt-ink rounded-md bg-[var(--color-mkt-red)]/10 px-4 py-3 text-sm"
        >
          {errorMessage}
        </div>
      )}

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <p className="text-mkt-slate text-xs">
          We respond to support within 24h, security disclosures within 72h.
        </p>
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="bg-mkt-red inline-flex h-11 items-center rounded-md px-7 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === 'submitting' ? 'Sending…' : 'Send message'}
        </button>
      </div>
    </form>
  )
}

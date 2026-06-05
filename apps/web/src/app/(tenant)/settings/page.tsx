'use client'

/**
 * Tenant settings — handle/slug rename (§2.3 / §9.14).
 *
 * Reads the current tenant via GET /tenant/me, shows the public URL, and lets
 * the owner rename their handle (the `{handle}` in event URLs). PATCH
 * /tenant/me/handle does the validation + uniqueness + reserved checks and
 * writes a 30-day redirect, so old links keep working for a month.
 */

import { useEffect, useState } from 'react'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

function publicBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_PUBLIC_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : 'https://eventpulse.com.bd'
}

interface Tenant {
  name: string
  slug: string
  isPersonal: boolean
}

export function TenantSettings() {
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/v1/tenant/me`, { credentials: 'include' })
        if (!res.ok) {
          setError('Could not load your settings. Please try again.')
          return
        }
        const body = (await res.json()) as { data: { tenant: Tenant } }
        setTenant(body.data.tenant)
        setHandle(body.data.tenant.slug)
      } catch {
        setError('Network error. Please try again.')
      }
    })()
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      const res = await fetch(`${apiBase()}/api/v1/tenant/me/handle`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ handle }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        data?: { slug?: string }
        error?: { message?: string }
      }
      if (res.ok && body.data?.slug) {
        setTenant((t) => (t ? { ...t, slug: body.data!.slug! } : t))
        setHandle(body.data.slug)
        setSaved(body.data.slug)
        setBusy(false)
        return
      }
      setError(body.error?.message ?? 'Could not rename your handle. Please try again.')
      setBusy(false)
    } catch {
      setError('Network error. Please try again.')
      setBusy(false)
    }
  }

  const currentUrl = tenant ? `${publicBase().replace(/^https?:\/\//, '')}/${tenant.slug}` : ''
  const dirty = tenant ? handle.trim().toLowerCase() !== tenant.slug.toLowerCase() : false

  return (
    <div className="text-mkt-ink mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-mkt-slate mt-2">Manage your public handle and account.</p>
      </header>

      <section className="border-mkt-line space-y-4 rounded-2xl border bg-white p-6">
        <div>
          <h2 className="text-lg font-semibold">Your handle</h2>
          <p className="text-mkt-slate mt-1 text-sm">
            This is the <code className="text-mkt-ink">{`{handle}`}</code> in your event links.
            Renaming keeps old links working for 30 days.
          </p>
        </div>

        {tenant && (
          <p className="text-mkt-slate text-sm">
            Current: <span className="text-mkt-ink font-medium">{currentUrl}</span>
          </p>
        )}

        <form onSubmit={save} className="space-y-3">
          <label htmlFor="handle" className="text-mkt-ink block text-sm font-medium">
            New handle
          </label>
          <div className="flex items-center gap-2">
            <span className="text-mkt-slate text-sm">
              {publicBase().replace(/^https?:\/\//, '')}/
            </span>
            <input
              id="handle"
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              placeholder="your-handle"
              autoCapitalize="none"
              spellCheck={false}
              className="border-mkt-line focus:border-mkt-red min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
            />
          </div>
          <p className="text-mkt-slate text-xs">
            3–30 characters · lowercase letters, numbers and hyphens.
          </p>

          {error && (
            <p role="alert" className="text-mkt-red text-sm">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="text-sm text-emerald-600">
              Saved — your handle is now <strong>{saved}</strong>.
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !dirty || handle.trim().length < 3}
            className="bg-mkt-red inline-flex h-11 items-center rounded-md px-6 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save handle'}
          </button>
        </form>
      </section>
    </div>
  )
}

export default function TenantSettingsPage() {
  return <TenantSettings />
}

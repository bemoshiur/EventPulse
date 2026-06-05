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
  brandLogoUrl: string | null
  brandColorPrimary: string | null
  brandColorAccent: string | null
}

const DEFAULT_PRIMARY = '#d32f2f'
const DEFAULT_ACCENT = '#ff6f61'

export function TenantSettings() {
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  // Branding
  const [logoUrl, setLogoUrl] = useState('')
  const [primary, setPrimary] = useState(DEFAULT_PRIMARY)
  const [accent, setAccent] = useState(DEFAULT_ACCENT)
  const [brandBusy, setBrandBusy] = useState(false)
  const [brandSaved, setBrandSaved] = useState(false)
  const [brandError, setBrandError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/v1/tenant/me`, { credentials: 'include' })
        if (!res.ok) {
          setError('Could not load your settings. Please try again.')
          return
        }
        const body = (await res.json()) as { data: { tenant: Tenant } }
        const t = body.data.tenant
        setTenant(t)
        setHandle(t.slug)
        setLogoUrl(t.brandLogoUrl ?? '')
        setPrimary(t.brandColorPrimary ?? DEFAULT_PRIMARY)
        setAccent(t.brandColorAccent ?? DEFAULT_ACCENT)
      } catch {
        setError('Network error. Please try again.')
      }
    })()
  }, [])

  async function saveBrand(e: React.FormEvent) {
    e.preventDefault()
    setBrandBusy(true)
    setBrandError(null)
    setBrandSaved(false)
    try {
      const res = await fetch(`${apiBase()}/api/v1/tenant/me/brand`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          logoUrl: logoUrl.trim() === '' ? null : logoUrl.trim(),
          colorPrimary: primary,
          colorAccent: accent,
        }),
      })
      if (res.ok) {
        setBrandSaved(true)
        setBrandBusy(false)
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      setBrandError(body.error?.message ?? 'Could not save your branding. Please try again.')
      setBrandBusy(false)
    } catch {
      setBrandError('Network error. Please try again.')
      setBrandBusy(false)
    }
  }

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

      <section className="border-mkt-line space-y-4 rounded-2xl border bg-white p-6">
        <div>
          <h2 className="text-lg font-semibold">Branding</h2>
          <p className="text-mkt-slate mt-1 text-sm">
            Your logo and colours appear on your public event pages.
          </p>
        </div>

        <form onSubmit={saveBrand} className="space-y-4">
          <div>
            <label htmlFor="logo" className="text-mkt-ink block text-sm font-medium">
              Logo URL
            </label>
            <input
              id="logo"
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://…/logo.png"
              className="border-mkt-line focus:border-mkt-red mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
            />
            <p className="text-mkt-slate mt-1 text-xs">Paste a hosted image URL (PNG/SVG).</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="primary" className="text-mkt-ink block text-sm font-medium">
                Primary colour
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="primary"
                  type="color"
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                  className="border-mkt-line h-10 w-12 rounded-md border bg-white"
                />
                <span className="text-mkt-slate font-mono text-sm">{primary}</span>
              </div>
            </div>
            <div>
              <label htmlFor="accent" className="text-mkt-ink block text-sm font-medium">
                Accent colour
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="accent"
                  type="color"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  className="border-mkt-line h-10 w-12 rounded-md border bg-white"
                />
                <span className="text-mkt-slate font-mono text-sm">{accent}</span>
              </div>
            </div>
          </div>

          {/* Live preview of the event hero gradient */}
          <div
            className="flex h-20 items-center justify-center rounded-xl text-sm font-semibold text-white"
            style={{ background: `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)` }}
          >
            Event hero preview
          </div>

          {brandError && (
            <p role="alert" className="text-mkt-red text-sm">
              {brandError}
            </p>
          )}
          {brandSaved && (
            <p role="status" className="text-sm text-emerald-600">
              Branding saved — it’s live on your event pages.
            </p>
          )}

          <button
            type="submit"
            disabled={brandBusy}
            className="bg-mkt-red inline-flex h-11 items-center rounded-md px-6 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {brandBusy ? 'Saving…' : 'Save branding'}
          </button>
        </form>
      </section>
    </div>
  )
}

export default function TenantSettingsPage() {
  return <TenantSettings />
}

'use client'

/**
 * Event discovery — BookMyShow-style browse by category + area + search.
 * Fetches /api/v1/public/discover (filters as query params) + /discover/cities.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, MapPin, Search, Ticket } from 'lucide-react'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

interface DiscoverEvent {
  tenantSlug: string
  tenantName: string
  slug: string
  type: string
  title: string
  titleBn: string | null
  startsAt: string
  venueName: string | null
  city: string | null
  isOnline: boolean
  bannerImageUrl: string | null
  fromPricePaisa: string | null
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'concert', label: 'Concerts' },
  { value: 'standup', label: 'Comedy' },
  { value: 'conference', label: 'Conferences' },
  { value: 'workshop', label: 'Workshops' },
  { value: 'alumni', label: 'Alumni' },
  { value: 'sports', label: 'Sports' },
  { value: 'community', label: 'Community' },
  { value: 'other', label: 'Other' },
]

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.filter((c) => c.value).map((c) => [c.value, c.label.replace(/s$/, '')]),
)

function formatPrice(paisa: string | null): string {
  if (paisa === null) return 'Free entry'
  const big = BigInt(paisa)
  if (big === 0n) return 'Free'
  const grouped = (big / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `From ৳${grouped}`
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

const CARD_GRADIENTS = [
  'from-rose-500 to-orange-400',
  'from-violet-500 to-indigo-500',
  'from-emerald-500 to-teal-400',
  'from-sky-500 to-blue-500',
  'from-amber-500 to-pink-500',
]

export function DiscoverClient() {
  const [events, setEvents] = useState<DiscoverEvent[]>([])
  const [cities, setCities] = useState<string[]>([])
  const [category, setCategory] = useState('')
  const [city, setCity] = useState('')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [loading, setLoading] = useState(true)

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    fetch(`${apiBase()}/api/v1/public/discover/cities`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b: { data: string[] }) => setCities(b.data))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (city) params.set('city', city)
    if (debouncedQ) params.set('q', debouncedQ)
    try {
      const r = await fetch(`${apiBase()}/api/v1/public/discover?${params.toString()}`, {
        cache: 'no-store',
      })
      const b = (await r.json()) as { data: DiscoverEvent[] }
      setEvents(b.data ?? [])
    } catch {
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [category, city, debouncedQ])

  useEffect(() => {
    void load()
  }, [load])

  const cityOptions = useMemo(() => ['', ...cities], [cities])

  return (
    <div className="font-[family-name:var(--font-bangla)]">
      {/* ── Hero + search ── */}
      <section className="mkt-hero border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-6xl px-6 py-12 md:py-16">
          <h1 className="text-mkt-ink text-3xl font-bold tracking-tight md:text-5xl">
            Discover events near you
          </h1>
          <p className="text-mkt-slate mt-3 max-w-xl text-base" lang="bn">
            কনসার্ট, কমেডি, কনফারেন্স, ওয়ার্কশপ — আপনার শহরে যা ঘটছে।
          </p>
          <div className="relative mt-6 max-w-xl">
            <Search className="text-mkt-slate/60 pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search events or venues…"
              className="border-mkt-line text-mkt-ink placeholder:text-mkt-slate/50 focus:border-mkt-red h-13 w-full rounded-xl border bg-white py-3.5 pr-4 pl-12 text-base shadow-sm focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* ── Filters ── */}
      <section className="border-b border-[var(--color-mkt-line)] bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="-mx-1 flex flex-nowrap gap-2 overflow-x-auto px-1 pb-1">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                  category === c.value
                    ? 'bg-mkt-red border-mkt-red text-white'
                    : 'border-mkt-line text-mkt-slate hover:border-mkt-red hover:text-mkt-red bg-white'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {cities.length > 0 && (
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="border-mkt-line text-mkt-ink focus:border-mkt-red h-10 shrink-0 rounded-md border bg-white px-3 text-sm focus:outline-none"
            >
              {cityOptions.map((cc) => (
                <option key={cc || 'all'} value={cc}>
                  {cc || 'All areas'}
                </option>
              ))}
            </select>
          )}
        </div>
      </section>

      {/* ── Grid ── */}
      <section className="bg-mkt-soft min-h-[40vh]">
        <div className="mx-auto max-w-6xl px-6 py-10">
          {loading ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="border-mkt-line animate-pulse rounded-2xl border bg-white">
                  <div className="bg-mkt-line/60 aspect-[16/9] rounded-t-2xl" />
                  <div className="space-y-2 p-4">
                    <div className="bg-mkt-line/60 h-4 w-3/4 rounded" />
                    <div className="bg-mkt-line/60 h-3 w-1/2 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="border-mkt-line rounded-2xl border border-dashed bg-white py-20 text-center">
              <Ticket className="text-mkt-slate/40 mx-auto size-10" />
              <p className="text-mkt-ink mt-4 font-semibold">No events found</p>
              <p className="text-mkt-slate mt-1 text-sm">
                Try a different category or area — new events are added all the time.
              </p>
            </div>
          ) : (
            <>
              <p className="text-mkt-slate mb-5 text-sm">
                {events.length} event{events.length === 1 ? '' : 's'}
                {category ? ` · ${CATEGORY_LABEL[category] ?? category}` : ''}
                {city ? ` · ${city}` : ''}
              </p>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {events.map((e, i) => (
                  <Link
                    key={`${e.tenantSlug}/${e.slug}`}
                    href={`/${e.tenantSlug}/${e.slug}`}
                    className="group border-mkt-line overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                  >
                    <div className="relative aspect-[16/9] overflow-hidden">
                      {e.bannerImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={e.bannerImageUrl}
                          alt=""
                          className="size-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div
                          className={`flex size-full items-center justify-center bg-gradient-to-br ${CARD_GRADIENTS[i % CARD_GRADIENTS.length]} p-4 text-center`}
                        >
                          <span className="line-clamp-3 text-lg font-bold text-white/95">
                            {e.title}
                          </span>
                        </div>
                      )}
                      <span className="bg-mkt-ink/80 absolute top-3 left-3 rounded-full px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
                        {CATEGORY_LABEL[e.type] ?? e.type}
                      </span>
                    </div>
                    <div className="p-4">
                      <h3 className="text-mkt-ink group-hover:text-mkt-red line-clamp-2 font-semibold transition">
                        {e.title}
                      </h3>
                      <div className="text-mkt-slate mt-2 space-y-1 text-sm">
                        <p className="flex items-center gap-1.5">
                          <CalendarDays className="size-3.5 shrink-0" />
                          {formatDate(e.startsAt)}
                        </p>
                        <p className="flex items-center gap-1.5">
                          <MapPin className="size-3.5 shrink-0" />
                          <span className="truncate">
                            {e.isOnline
                              ? 'Online'
                              : [e.venueName, e.city].filter(Boolean).join(', ') || 'TBA'}
                          </span>
                        </p>
                      </div>
                      <div className="border-mkt-line mt-3 flex items-center justify-between border-t pt-3">
                        <span className="text-mkt-red text-sm font-bold">
                          {formatPrice(e.fromPricePaisa)}
                        </span>
                        <span className="text-mkt-slate text-xs">{e.tenantName}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

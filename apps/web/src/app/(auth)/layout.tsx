/**
 * Auth surface layout — the first impression for returning + new users.
 *
 * Mirrors the marketing site's visual language (and the sister product's auth
 * UX): a floating-pill header with a "Visit homepage" escape hatch, a brand
 * micro-banner above the form card, and a trust strip below it. Each page under
 * (auth) renders its own `.mkt-card` (the form); this layout supplies the
 * surrounding chrome so every auth screen (sign-in, sign-up, choose-tenant,
 * admin, magic) gets it for free.
 *
 * Rendered per-request (`force-dynamic`): without it Next prerenders the login
 * shells with `s-maxage=1y`, so a browser/CDN can pin a STALE login page that
 * references purged JS chunks → broken form / "Network error" on submit
 * (reported Day 47). Login traffic is tiny, so per-request rendering is free.
 */

import Link from 'next/link'
import { ArrowLeft, ExternalLink, ShieldCheck } from 'lucide-react'

const HOME_URL = 'https://eventpulse.com.bd'

export const dynamic = 'force-dynamic'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mkt-hero text-mkt-ink relative flex min-h-screen flex-col font-[family-name:var(--font-bangla)]">
      {/* Floating-pill header — same vocabulary as the marketing nav so the
          auth surface clearly belongs to the same product, with an escape
          hatch so a signed-out visitor never feels trapped. */}
      <header className="relative z-10 px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="border-mkt-line mx-auto flex max-w-5xl items-center justify-between rounded-full border bg-white/80 px-4 py-2 shadow-sm backdrop-blur sm:px-5">
          <Link
            href={HOME_URL}
            className="text-mkt-ink flex items-center gap-2 text-sm font-bold tracking-tight transition outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--color-mkt-red)]/40"
          >
            <span className="bg-mkt-red inline-block size-2.5 rounded-full" aria-hidden />
            Event Pulse
          </Link>
          <a
            href={HOME_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="border-mkt-line text-mkt-slate hover:text-mkt-ink hover:border-mkt-red inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1.5 text-xs font-semibold transition sm:px-3.5"
            aria-label="Visit the Event Pulse homepage in a new tab"
          >
            <ExternalLink className="size-3.5" />
            <span className="hidden sm:inline">Visit homepage</span>
            <span className="sm:hidden">Home</span>
          </a>
        </div>
      </header>

      {/* Form card (page children) + micro-banner above + trust strip below. */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-14">
        <div className="w-full max-w-md">
          <div className="text-mkt-red/80 mb-3 flex items-center justify-center gap-2 text-[11px] font-semibold tracking-widest uppercase">
            <span>Event Pulse</span>
            <span className="text-mkt-red/40">·</span>
            <span className="text-mkt-slate">Ticketing for Bangladesh</span>
          </div>

          {children}

          <div className="text-mkt-slate mt-5 grid grid-cols-3 gap-2 text-[10.5px] sm:text-[11px]">
            <div className="border-mkt-line inline-flex items-center justify-center gap-1.5 rounded-full border bg-white/70 px-2.5 py-1.5 backdrop-blur">
              <ShieldCheck className="size-3 text-emerald-600" />
              <span className="font-medium">Secure payments</span>
            </div>
            <div className="border-mkt-line inline-flex items-center justify-center gap-1.5 rounded-full border bg-white/70 px-2.5 py-1.5 backdrop-blur">
              <span className="bg-mkt-red size-1.5 rounded-full" aria-hidden />
              <span className="font-medium">Paid in T+5</span>
            </div>
            <div className="border-mkt-line inline-flex items-center justify-center gap-1.5 rounded-full border bg-white/70 px-2.5 py-1.5 backdrop-blur">
              <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
              <span className="font-medium">No card needed</span>
            </div>
          </div>
        </div>
      </main>

      {/* Back-home escape hatch for users who scroll past the form. */}
      <footer className="text-mkt-slate relative z-10 px-4 pb-6 text-center text-[11px] sm:px-6">
        <Link
          href={HOME_URL}
          className="hover:text-mkt-ink inline-flex items-center gap-1 transition"
        >
          <ArrowLeft className="size-3" />
          Back to Event Pulse home
        </Link>
      </footer>
    </div>
  )
}

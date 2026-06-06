import { ArrowRight, ChevronRight, Mail, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { LanguageToggle } from './language-toggle'

/**
 * Marketing footer — three bands: a CTA band, a brand + nav grid, and a trust
 * dossier strip + bottom bar. Red/white marketing theme, bilingual EN + বাংলা.
 */

function Bn({ children }: { children: ReactNode }) {
  return <span lang="bn">{children}</span>
}

const COLUMNS = [
  {
    heading: 'Product',
    bn: 'প্রোডাক্ট',
    links: [
      { href: '/discover', label: 'Discover events' },
      { href: '/features', label: 'Features' },
      { href: '/how-it-works', label: 'How it works' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/demo', label: 'Live demo' },
      { href: '/glossary', label: 'Glossary' },
      { href: '/legal/changelog', label: 'Changelog' },
    ],
  },
  {
    heading: 'Company',
    bn: 'কোম্পানি',
    links: [
      { href: '/my-tickets', label: 'Find my tickets' },
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
      { href: '/book-a-demo', label: 'Book a demo' },
      { href: '/faq', label: 'FAQ' },
      { href: '/blog', label: 'Blog' },
      { href: '/customers', label: 'Customers' },
    ],
  },
  {
    heading: 'Trust & legal',
    bn: 'ট্রাস্ট ও লিগ্যাল',
    links: [
      { href: '/trust', label: 'Trust Center' },
      { href: '/trust/security', label: 'Security' },
      { href: '/trust/sla', label: 'SLA' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
      { href: '/eula', label: 'EULA' },
      { href: '/dpa', label: 'DPA' },
      { href: '/cookies', label: 'Cookies' },
      { href: '/refund-policy', label: 'Refund Policy' },
    ],
  },
] as const

const DOSSIER = [
  'Per-tenant data isolation',
  'KMS-encrypted KYC',
  'EPS-verified payments',
  'Escrow + automated T+5',
  'Audit-logged actions',
  'BFIU 5-year retention',
] as const

const HELP_EMAIL = 'support@eventpulse.com.bd'

export function MarketingFooter() {
  return (
    <footer className="border-mkt-line bg-mkt-soft relative isolate mt-auto overflow-hidden border-t font-[family-name:var(--font-bangla)]">
      {/* hairline accent */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--color-mkt-red)] to-transparent opacity-60"
      />

      {/* ── 1 · CTA band ─────────────────────────────────────── */}
      <section className="relative mx-auto max-w-6xl px-6 pt-16 pb-12 lg:px-10">
        <div className="mkt-hero relative overflow-hidden rounded-3xl border border-[var(--color-mkt-red)]/25 px-6 py-8 shadow-sm sm:px-10 sm:py-10">
          <div className="relative grid items-end gap-7 md:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <span className="border-mkt-red/30 mb-4 inline-flex items-center gap-2 rounded-full border bg-white/80 px-3 py-1.5 backdrop-blur">
                <span className="relative flex size-1.5">
                  <span className="bg-mkt-red absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" />
                  <span className="bg-mkt-red relative inline-flex size-1.5 rounded-full" />
                </span>
                <span className="text-mkt-red text-[10px] font-bold tracking-[0.22em] uppercase">
                  Start today · <Bn>আজই শুরু</Bn>
                </span>
              </span>
              <h3 className="text-2xl font-bold tracking-tight md:text-[28px] lg:text-[32px]">
                Your next event, <span className="text-mkt-red">live in 90 seconds.</span>
              </h3>
              <p className="text-mkt-slate mt-2.5 max-w-md text-[14.5px] leading-relaxed">
                <Bn>ফ্রি ইভেন্ট সঙ্গে সঙ্গে লাইভ · পেইড ইভেন্টে দ্রুত KYC · ৫ দিনে টাকা।</Bn>
              </p>
            </div>
            <div className="flex flex-col gap-2.5 sm:flex-row md:flex-col lg:flex-row">
              <Link
                href="/demo"
                className="border-mkt-line hover:border-mkt-red hover:text-mkt-red group inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border bg-white px-5 text-sm font-semibold transition"
              >
                Live demo
                <ChevronRight className="size-4 opacity-60 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/sign-up"
                className="bg-mkt-red group inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white shadow-[var(--color-mkt-red)]/25 shadow-lg transition hover:bg-[var(--color-mkt-red-dark)]"
              >
                Start free
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2 · Brand + nav grid ─────────────────────────────── */}
      <section className="relative mx-auto max-w-6xl px-6 pb-12 lg:px-10">
        <div className="grid gap-12 md:grid-cols-12">
          {/* brand */}
          <div className="md:col-span-5">
            <Link
              href="/"
              className="text-mkt-ink flex items-center gap-2 text-base font-bold tracking-tight"
            >
              <span aria-hidden="true" className="bg-mkt-red inline-block size-2.5 rounded-full" />
              Event Pulse
            </Link>
            <p className="text-mkt-slate mt-4 max-w-sm text-sm leading-relaxed">
              The event ticketing platform built for Bangladesh — branded pages, EPS checkout, QR
              check-in, and automated T+5 payouts at a transparent 0.25%.
            </p>
            <a
              href={`mailto:${HELP_EMAIL}`}
              className="text-mkt-slate hover:text-mkt-red mt-5 inline-flex items-center gap-2 text-sm font-medium transition"
            >
              <Mail className="size-4" aria-hidden="true" />
              {HELP_EMAIL}
            </a>
          </div>

          {/* nav columns */}
          {COLUMNS.map((col) => (
            <div key={col.heading} className="md:col-span-2">
              <h3 className="text-mkt-slate text-xs font-semibold tracking-[0.14em] uppercase">
                {col.heading} · <Bn>{col.bn}</Bn>
              </h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-mkt-slate hover:text-mkt-red text-sm transition"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── 3 · Trust dossier strip ──────────────────────────── */}
      <section className="border-mkt-line relative mx-auto max-w-6xl border-t px-6 py-10 lg:px-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-xl">
            <div className="flex items-center gap-2">
              <p className="text-mkt-slate text-xs font-semibold tracking-[0.14em] uppercase">
                Trust dossier · <Bn>ট্রাস্ট</Bn>
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Operational
              </span>
            </div>
            <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
              {DOSSIER.map((d) => (
                <li key={d} className="text-mkt-ink flex items-center gap-1.5 text-xs font-medium">
                  <ShieldCheck className="text-mkt-red size-3.5" aria-hidden="true" />
                  {d}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-mkt-slate max-w-md text-xs leading-relaxed">
            Data resides in our Singapore region (ap-southeast-1) with low Bangladesh latency.
            Per-tenant row-level isolation, KMS-managed keys, and EPS-verified payments — never used
            to train any third-party model.{' '}
            <Link href="/trust/security" className="text-mkt-red font-semibold hover:underline">
              Read the security stance
            </Link>
            .
          </p>
        </div>
      </section>

      {/* ── 4 · Bottom bar ───────────────────────────────────── */}
      <div className="border-mkt-line border-t">
        <div className="text-mkt-slate mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 text-xs lg:flex-row lg:px-10">
          <span>
            &copy; 2026 <strong className="text-mkt-ink">Event Pulse</strong> · Public Pulse Agency
          </span>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <LanguageToggle />
            <Link href="/legal/changelog" className="hover:text-mkt-red transition">
              Changelog
            </Link>
            <Link href="/trust/sub-processors" className="hover:text-mkt-red transition">
              Sub-processors
            </Link>
            <Link href="/trust/security/disclosure" className="hover:text-mkt-red transition">
              Vulnerability disclosure
            </Link>
            <span>Dhaka, Bangladesh 🇧🇩</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'

import { GlassCard } from '@/components/ui/glass-card'
import { GradientMesh } from '@/components/ui/gradient-mesh'
import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'

export const metadata: Metadata = {
  title: 'Event Pulse — Run your events. Get paid in 5 days.',
  description:
    'Multi-tenant ticketing platform built for Bangladesh. Branded landing pages, custom registration forms, bKash checkout, automated T+5 disbursement, and transparent 0.25% platform fee.',
  openGraph: {
    title: 'Event Pulse — Run your events. Get paid in 5 days.',
    description: 'Branded landing pages, custom forms, bKash checkout, automated T+5 disbursement.',
    type: 'website',
  },
}

const VALUE_PROPS = [
  {
    title: 'Branded event pages',
    body: 'Tenant-owned landing pages with your logo, colours, and banner. Optional custom domain on day one.',
  },
  {
    title: 'Custom registration forms',
    body: 'Collect exactly what your event needs — text, NID, file uploads, conditional logic, per-tier variations.',
  },
  {
    title: 'bKash checkout at launch',
    body: 'Buyers pay via bKash through EPS hosted checkout. Card and other methods rolling out week 1 post-launch.',
  },
  {
    title: 'QR tickets + check-in',
    body: 'Every attendee gets a QR-coded ticket by email. Scan on the web from any browser at the gate.',
  },
  {
    title: 'T+5 disbursement',
    body: 'Net proceeds settle to your bank or MFS account five business days after each transaction.',
  },
  {
    title: 'Transparent 0.25%',
    body: 'A flat 0.25% platform fee — published on day one, payable per transaction. EPS gateway fees pass through at cost.',
  },
] as const

const EVENT_TYPES = [
  'Concerts',
  'Alumni gatherings',
  'Comedy nights',
  'Conferences',
  'Workshops',
  'Community meetups',
  'Sports tournaments',
] as const

export default function HomePage() {
  return (
    <>
      <main className="relative min-h-screen bg-[var(--ep-mist)]">
        <GradientMesh />
        <MarketingNavbar />

        <section className="relative">
          <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-24 text-center md:py-32">
            <span className="ep-reveal inline-flex items-center gap-2 rounded-full bg-[var(--ep-paper)]/70 px-4 py-1.5 text-xs font-medium text-[var(--ep-graphite)] shadow-sm backdrop-blur">
              <span aria-hidden="true" className="size-2 rounded-full bg-[var(--ep-mint)]" />
              Built for Bangladesh
            </span>

            <h1 className="ep-reveal ep-reveal-1 text-hero mt-6 text-[var(--ep-ink)]">
              Run your events. <span className="ep-gradient-text">Get paid in 5 days.</span>
            </h1>

            <p className="ep-reveal ep-reveal-2 mt-6 max-w-2xl text-lg leading-relaxed text-[var(--ep-graphite)]">
              Event Pulse is the multi-tenant ticketing platform for Bangladesh. Branded landing
              pages, custom registration forms, bKash checkout, automated T+5 disbursement — on one
              platform.
            </p>

            <div className="ep-reveal ep-reveal-3 mt-10 flex flex-col items-center gap-3 sm:flex-row">
              <Link
                href="/sign-up"
                className="inline-flex h-12 items-center rounded-md bg-gradient-to-r from-[var(--ep-violet)] to-[var(--ep-indigo)] px-8 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                Create your first event
              </Link>
              <Link
                href="/pricing"
                className="inline-flex h-12 items-center rounded-md border border-[var(--ep-line)] bg-[var(--ep-paper)]/70 px-8 text-sm font-semibold text-[var(--ep-ink)] backdrop-blur transition hover:-translate-y-0.5 hover:shadow-sm"
              >
                See pricing
              </Link>
            </div>

            <p className="ep-reveal ep-reveal-4 mt-6 text-xs text-[var(--ep-graphite)]">
              No setup fee. No monthly minimum. KYC required before selling paid tickets.
            </p>
          </div>
        </section>

        <section className="relative">
          <div className="mx-auto max-w-6xl px-6 pb-16 md:pb-24">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {VALUE_PROPS.map((prop) => (
                <GlassCard key={prop.title} className="p-8">
                  <h3 className="text-lg font-semibold text-[var(--ep-ink)]">{prop.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--ep-graphite)]">
                    {prop.body}
                  </p>
                </GlassCard>
              ))}
            </div>
          </div>
        </section>

        <section className="relative">
          <div className="mx-auto max-w-5xl px-6 pb-16 md:pb-24">
            <GlassCard variant="strong" className="p-10 md:p-14">
              <div className="grid gap-10 md:grid-cols-2 md:items-center">
                <div>
                  <p className="text-xs font-semibold tracking-widest text-[var(--ep-violet)] uppercase">
                    Use cases
                  </p>
                  <h2 className="font-display mt-3 text-3xl font-semibold text-[var(--ep-ink)] md:text-4xl">
                    Whatever you’re hosting.
                  </h2>
                  <p className="mt-4 text-sm leading-relaxed text-[var(--ep-graphite)]">
                    From 30-person workshops to 5,000-attendee concerts, the same toolkit scales.
                    Pick a template, brand the page, open ticket sales.
                  </p>
                </div>
                <ul className="grid grid-cols-2 gap-3">
                  {EVENT_TYPES.map((type) => (
                    <li
                      key={type}
                      className="rounded-lg border border-[var(--ep-line)]/60 bg-[var(--ep-paper)]/60 px-4 py-3 text-sm font-medium text-[var(--ep-ink)] backdrop-blur"
                    >
                      {type}
                    </li>
                  ))}
                </ul>
              </div>
            </GlassCard>
          </div>
        </section>

        <section className="relative">
          <div className="mx-auto max-w-4xl px-6 pb-24 text-center">
            <h2 className="font-display text-3xl font-semibold text-[var(--ep-ink)] md:text-4xl">
              Ready in under 90 seconds.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[var(--ep-graphite)]">
              Sign up with email, Google, or Apple. Free events publish instantly. Paid events
              graduate through a quick KYC check before tickets go live.
            </p>
            <div className="mt-8">
              <Link
                href="/sign-up"
                className="inline-flex h-12 items-center rounded-md bg-gradient-to-r from-[var(--ep-coral)] to-[var(--ep-rose)] px-8 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                Start free
              </Link>
            </div>
          </div>
        </section>

        <MarketingFooter />
      </main>
    </>
  )
}

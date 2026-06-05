import type { Metadata } from 'next'
import Link from 'next/link'

import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'

export const metadata: Metadata = {
  title: 'Customers — who Event Pulse is built for',
  description:
    'From concert promoters to universities to NGOs, see the kinds of organisers Event Pulse is built for — and be among the first to run on it.',
  alternates: { canonical: '/customers' },
}

const SEGMENTS = [
  {
    title: 'Concert & show promoters',
    body: 'Multi-tier pricing, capacity caps, and a fast gate for thousands of fans. Sell out a venue without your page falling over.',
  },
  {
    title: 'Universities & alumni',
    body: 'Batch-wise pricing, committee access, and a clean guest list for reunions, convocations, and departmental events.',
  },
  {
    title: 'Conferences & summits',
    body: 'Delegate, student, and sponsor tiers; custom forms for designations and dietary needs; QR badges at the door.',
  },
  {
    title: 'NGOs & nonprofits',
    body: 'Free RSVP events with no fees, paid fundraisers with transparent settlement, and a full record of every registration.',
  },
  {
    title: 'Corporate & community',
    body: 'Town halls, workshops, meetups, and launches — branded pages on your own domain, run by your own team.',
  },
  {
    title: 'Sports & tournaments',
    body: 'Team and spectator tickets, gate-wise check-in, and day-of capacity tracking across multiple entries.',
  },
]

export default function CustomersPage() {
  return (
    <>
      <MarketingNavbar />

      <section className="mkt-hero border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center md:py-24">
          <p className="text-mkt-red text-xs font-semibold tracking-[0.18em] uppercase">
            Customers · <span lang="bn">গ্রাহক</span>
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            Built for Bangladesh’s organisers.
          </h1>
          <p className="text-mkt-slate mt-4 text-base leading-relaxed">
            Event Pulse is new — and we’re onboarding our first organisers now. Here’s who it’s
            built for. If that’s you, you can be among the first to run on it.
          </p>
          <div className="mt-8">
            <Link
              href="/sign-up"
              className="bg-mkt-red inline-flex h-12 items-center rounded-lg px-7 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--color-mkt-red-dark)] hover:shadow-md"
            >
              Be an early organiser
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {SEGMENTS.map((s) => (
              <div key={s.title} className="mkt-card p-7">
                <h2 className="text-lg font-semibold">{s.title}</h2>
                <p className="text-mkt-slate mt-2 text-sm leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-mkt-soft border-y border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center md:py-20">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
            Want to be a featured customer?
          </h2>
          <p className="text-mkt-slate mt-3 text-base leading-relaxed">
            Run your event on Event Pulse and tell us how it went. We’d love to share your story
            here — with your permission, and only ever in your own words.
          </p>
          <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/sign-up"
              className="bg-mkt-red inline-flex h-12 items-center rounded-lg px-7 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[var(--color-mkt-red-dark)]"
            >
              Start free
            </Link>
            <Link
              href="/book-a-demo"
              className="border-mkt-line text-mkt-ink inline-flex h-12 items-center rounded-lg border bg-white px-7 text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-sm"
            >
              Book a demo
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'

import { ContactForm } from '@/components/marketing/contact-form'
import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'

export const metadata: Metadata = {
  title: 'Book a demo',
  description:
    'See Event Pulse on your own event. Book a 20-minute walkthrough — pages, forms, EPS checkout, QR check-in, and T+5 payouts — with our team in Dhaka.',
  alternates: { canonical: '/book-a-demo' },
}

const COVERED = [
  'A branded event page on your logo + colours',
  'A custom registration form for your event',
  'EPS checkout and how payments are verified',
  'QR tickets + the web check-in scanner',
  'The 0.25% fee modes and your T+5 payout',
  'KYC, custom domains, and team roles',
] as const

export default function BookADemoPage() {
  return (
    <>
      <MarketingNavbar />

      <section className="mkt-hero border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center md:py-20">
          <p className="text-mkt-red text-xs font-semibold tracking-[0.18em] uppercase">
            Book a demo · <span lang="bn">ডেমো বুক করুন</span>
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            See it on your own event.
          </h1>
          <p className="text-mkt-slate mt-4 text-base leading-relaxed">
            A 20-minute walkthrough with our team in Dhaka — or skip the call and{' '}
            <Link href="/sign-up" className="text-mkt-red font-semibold hover:underline">
              start free in 90 seconds
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid max-w-5xl gap-12 px-6 py-16 md:grid-cols-2 md:py-20">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">What we’ll cover</h2>
            <ul className="mt-6 space-y-3">
              {COVERED.map((c) => (
                <li key={c} className="text-mkt-ink flex items-start gap-3 text-sm">
                  <span className="bg-mkt-red/10 text-mkt-red mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
                    ✓
                  </span>
                  {c}
                </li>
              ))}
            </ul>
            <p className="text-mkt-slate mt-8 text-sm leading-relaxed">
              Prefer to watch first? See the{' '}
              <Link href="/demo" className="text-mkt-red font-semibold hover:underline">
                90-second demo
              </Link>{' '}
              — a full event, end to end, no sign-up.
            </p>
          </div>

          <div className="mkt-card p-6 sm:p-8">
            <h2 className="text-lg font-semibold">Request a demo</h2>
            <p className="text-mkt-slate mt-1 text-sm">
              Tell us about your event and we’ll be in touch within one business day.
            </p>
            <div className="mt-5">
              <ContactForm />
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'From sign-up to payout: how Event Pulse helps you create an event, sell tickets via EPS, check attendees in by QR, and get paid in five days.',
  alternates: { canonical: '/how-it-works' },
}

function Bn({ children }: { children: ReactNode }) {
  return <span lang="bn">{children}</span>
}

const STEPS = [
  {
    n: '01',
    title: 'Sign up & create',
    bn: 'সাইন আপ ও তৈরি',
    body: 'Sign in with a one-time email link — no passwords, no third-party logins. Pick an event type, fill in the basics, and a branded event page is generated for you. Free events publish instantly with no verification.',
    points: [
      'Email magic-link sign-in',
      'Eight event templates',
      'Branded page auto-generated',
      'Free events need no KYC',
    ],
  },
  {
    n: '02',
    title: 'Build the registration',
    bn: 'রেজিস্ট্রেশন তৈরি',
    body: 'Design exactly the form your event needs and set up ticket tiers with capacity and sales windows. Add a paid tier and a quick KYC step verifies you to handle money on your behalf.',
    points: [
      'Custom fields + conditional logic',
      'Multiple ticket tiers',
      'Capacity + sales windows',
      'KYC only for paid tiers',
    ],
  },
  {
    n: '03',
    title: 'Publish & sell',
    bn: 'প্রকাশ ও বিক্রি',
    body: 'Publish in one click and share your link. Buyers pay through EPS hosted checkout (bKash and more). Every payment is verified server-side with EPS — never trusted from the redirect — and a QR ticket is emailed instantly.',
    points: [
      'One-click publish + share',
      'EPS checkout (bKash)',
      'Server-verified payments',
      'QR ticket by email',
    ],
  },
  {
    n: '04',
    title: 'Check in & get paid',
    bn: 'চেক-ইন ও পেমেন্ট',
    body: 'At the gate, scan QR tickets from any phone browser — instant, de-duplicated, offline-tolerant. Net proceeds settle to your bank or MFS account five business days after each sale, with a full statement.',
    points: [
      'Web QR scanner, no app',
      'Multi-gate check-in',
      'Automated T+5 payout',
      'Full settlement statement',
    ],
  },
] as const

export default function HowItWorksPage() {
  return (
    <>
      <MarketingNavbar />

      <section className="mkt-hero border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center md:py-24">
          <p className="text-mkt-red text-xs font-semibold tracking-[0.18em] uppercase">
            How it works · <Bn>যেভাবে কাজ করে</Bn>
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            From an empty page to a paid-out event.
          </h1>
          <p className="text-mkt-slate mt-4 text-base leading-relaxed">
            Four steps, one platform — no spreadsheets, no personal bKash, no chaos at the gate.
          </p>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-5xl px-6 py-16 md:py-20">
          <ol className="space-y-12">
            {STEPS.map((s) => (
              <li key={s.n} className="grid gap-6 md:grid-cols-[auto_1fr] md:gap-10">
                <span className="text-mkt-red text-5xl font-bold">{s.n}</span>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">{s.title}</h2>
                  <p className="text-mkt-red mt-1 text-sm font-medium">
                    <Bn>{s.bn}</Bn>
                  </p>
                  <p className="text-mkt-slate mt-3 text-sm leading-relaxed">{s.body}</p>
                  <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                    {s.points.map((p) => (
                      <li key={p} className="text-mkt-ink flex items-start gap-2 text-sm">
                        <span className="bg-mkt-red/10 text-mkt-red mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
                          ✓
                        </span>
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-16 text-center">
            <Link
              href="/sign-up"
              className="bg-mkt-red inline-flex h-12 items-center rounded-lg px-7 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--color-mkt-red-dark)] hover:shadow-md"
            >
              Create your first event
            </Link>
            <p className="text-mkt-slate mt-3 text-sm">
              Or{' '}
              <Link href="/demo" className="text-mkt-red font-semibold hover:underline">
                watch the 90-second demo
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </>
  )
}

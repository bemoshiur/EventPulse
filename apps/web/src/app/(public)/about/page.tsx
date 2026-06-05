import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'

export const metadata: Metadata = {
  title: 'About',
  description:
    'Event Pulse is built in Dhaka by Public Pulse Agency — event ticketing infrastructure made for how Bangladesh actually runs events.',
  alternates: { canonical: '/about' },
}

function Bn({ children }: { children: ReactNode }) {
  return <span lang="bn">{children}</span>
}

const VALUES = [
  {
    title: 'Money is sacred',
    body: 'Every taka is tracked from checkout to payout. Funds sit in escrow, payments run through EPS — never a personal wallet — and you always know exactly what you’ll receive.',
  },
  {
    title: 'Bangladesh-first',
    body: 'EPS and bKash, T+5 payouts, BFIU-grade audit trails, and bilingual English + বাংলা pages. Built for the rails and the realities here, not bolted on later.',
  },
  {
    title: 'Pro-organiser by default',
    body: 'A flat, published 0.25% with no setup fee or lock-in. Free events stay free. You own your brand, your domain, and every attendee record.',
  },
  {
    title: 'Trust, in the open',
    body: 'Our Trust Center publishes how we handle data, security, and compliance. We’d rather earn trust with documents than slogans.',
  },
] as const

export default function AboutPage() {
  return (
    <>
      <MarketingNavbar />

      <section className="mkt-hero border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center md:py-24">
          <p className="text-mkt-red text-xs font-semibold tracking-[0.18em] uppercase">
            About · <Bn>আমাদের সম্পর্কে</Bn>
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            Ticketing infrastructure for how Bangladesh runs events.
          </h1>
          <p className="text-mkt-slate mt-4 text-base leading-relaxed">
            Event Pulse is a product of{' '}
            <strong className="text-mkt-ink">Public Pulse Agency</strong>, built in Dhaka. We make
            the operational layer — pages, forms, payments, check-in, payouts — so organisers can
            spend their time on the event, not the paperwork.
          </p>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-6 py-16 md:py-20">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Why we built it</h2>
          <div className="text-mkt-slate mt-4 space-y-4 text-base leading-relaxed">
            <p>
              Across Bangladesh, brilliant events run on a tangle of Google Forms, bKash
              screenshots, and WhatsApp guest lists. The hardest part of an event isn’t the event —
              it’s reconciling who paid, honouring real tickets at the gate, and getting the money
              out cleanly afterwards.
            </p>
            <p>
              We built Event Pulse to replace that tangle with one clean flow: a branded page, a
              custom form, EPS checkout, QR check-in, and an automated T+5 payout — at a transparent
              0.25%. Free events cost nothing; paid events graduate through a quick KYC the moment
              money is involved.
            </p>
            <p>
              It’s built on a multi-tenant core with per-tenant data isolation, encrypted KYC, and a
              settlement engine where every figure reconciles. The boring, load-bearing parts —
              because that’s where organisers and their attendees actually get protected.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-mkt-soft border-y border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-5xl px-6 py-16 md:py-20">
          <h2 className="text-center text-2xl font-bold tracking-tight md:text-3xl">
            What we stand for
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {VALUES.map((v) => (
              <div key={v.title} className="mkt-card p-7">
                <h3 className="text-lg font-semibold">{v.title}</h3>
                <p className="text-mkt-slate mt-2 text-sm leading-relaxed">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center md:py-20">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Built in Dhaka 🇧🇩</h2>
          <p className="text-mkt-slate mt-3 text-base leading-relaxed">
            Public Pulse Agency. Reach us any time at{' '}
            <a
              href="mailto:hello@eventpulse.com.bd"
              className="text-mkt-red font-semibold hover:underline"
            >
              hello@eventpulse.com.bd
            </a>
            .
          </p>
          <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/sign-up"
              className="bg-mkt-red inline-flex h-12 items-center rounded-lg px-7 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--color-mkt-red-dark)] hover:shadow-md"
            >
              Start free
            </Link>
            <Link
              href="/contact"
              className="border-mkt-line text-mkt-ink inline-flex h-12 items-center rounded-lg border bg-white px-7 text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-sm"
            >
              Contact us
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </>
  )
}

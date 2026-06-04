import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'

export const metadata: Metadata = {
  title: 'See it work — a live event, end to end',
  description:
    'Watch an event go from create → branded page → ticket checkout → QR ticket → web check-in → T+5 payout, in about 90 seconds. No sign-up.',
  alternates: { canonical: '/demo' },
}

function Bn({ children }: { children: ReactNode }) {
  return <span lang="bn">{children}</span>
}

const STAGES = [
  {
    n: '01',
    t: '0:00',
    title: 'Create the event',
    bn: 'ইভেন্ট তৈরি',
    body: 'An organiser signs in with a one-time email link, picks “Concert”, and fills the basics. A branded page is generated instantly.',
    screen: {
      kind: 'form',
      lines: [
        'Title — Dhaka Indie Night 2026',
        'Starts — 12 Jul, 7:00 PM · Asia/Dhaka',
        'Venue — ICCB, Hall 4',
      ],
    },
  },
  {
    n: '02',
    t: '0:20',
    title: 'Add ticket tiers',
    bn: 'টিকিট টিয়ার',
    body: 'Two tiers, capacity, and a sales window. The moment a paid tier is added, a quick KYC step verifies the organiser to handle money.',
    screen: {
      kind: 'tiers',
      rows: [
        ['General', '৳ 800', '500 left'],
        ['Front row', '৳ 2,000', '80 left'],
      ],
    },
  },
  {
    n: '03',
    t: '0:35',
    title: 'Publish & share',
    bn: 'প্রকাশ ও শেয়ার',
    body: 'One click publishes the public page. The shareable link goes out on socials — bilingual, fast, and on the organiser’s own brand.',
    screen: { kind: 'url', url: 'eventpulse.com.bd/dhaka-indie/indie-night-2026' },
  },
  {
    n: '04',
    t: '0:55',
    title: 'A buyer checks out',
    bn: 'ক্রেতা পেমেন্ট করে',
    body: 'A fan picks Front row, fills the form, and pays via EPS (bKash). The payment is verified server-side with EPS — never trusted from the redirect.',
    screen: {
      kind: 'checkout',
      lines: ['Front row × 1', '৳ 2,000.00', 'Pay with bKash via EPS'],
    },
  },
  {
    n: '05',
    t: '1:10',
    title: 'QR ticket + check-in',
    bn: 'QR টিকিট ও চেক-ইন',
    body: 'A QR ticket lands in the buyer’s inbox. At the gate, a volunteer scans it from a phone browser — instant, de-duplicated, offline-tolerant.',
    screen: { kind: 'ticket', code: 'EP-7H2K-9QX4', status: 'Checked in · Gate A' },
  },
  {
    n: '06',
    t: '1:30',
    title: 'Paid in 5 days',
    bn: '৫ দিনে টাকা',
    body: 'Net proceeds settle to the organiser’s bank or MFS account T+5, with a full statement — gross, the 0.25% fee, EPS fees, refunds.',
    screen: {
      kind: 'payout',
      rows: [
        ['Gross', '৳ 2,000.00'],
        ['Platform fee 0.25%', '− ৳ 5.00'],
        ['Net to you (T+5)', '৳ 1,995.00'],
      ],
    },
  },
] as const

function Screen({ s }: { s: (typeof STAGES)[number]['screen'] }) {
  return (
    <div className="border-mkt-line rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
      </div>
      {s.kind === 'form' && (
        <ul className="space-y-2">
          {s.lines.map((l) => (
            <li
              key={l}
              className="border-mkt-line text-mkt-ink rounded-md border bg-[var(--color-mkt-soft)] px-3 py-2 text-sm"
            >
              {l}
            </li>
          ))}
        </ul>
      )}
      {s.kind === 'tiers' && (
        <ul className="space-y-2">
          {s.rows.map((r) => (
            <li
              key={r[0]}
              className="border-mkt-line flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span className="text-mkt-ink font-medium">{r[0]}</span>
              <span className="text-mkt-red font-semibold">{r[1]}</span>
              <span className="text-mkt-slate text-xs">{r[2]}</span>
            </li>
          ))}
        </ul>
      )}
      {s.kind === 'url' && (
        <div className="flex items-center justify-between gap-2">
          <code className="text-mkt-red truncate rounded-md bg-[var(--color-mkt-soft)] px-3 py-2 text-sm">
            {s.url}
          </code>
          <span className="bg-mkt-red rounded-md px-3 py-2 text-xs font-semibold text-white">
            Copy
          </span>
        </div>
      )}
      {s.kind === 'checkout' && (
        <ul className="space-y-2">
          {s.lines.map((l, i) => (
            <li
              key={l}
              className={
                i === s.lines.length - 1
                  ? 'bg-mkt-red rounded-md px-3 py-2 text-center text-sm font-semibold text-white'
                  : 'text-mkt-ink flex items-center justify-between px-1 text-sm'
              }
            >
              {l}
            </li>
          ))}
        </ul>
      )}
      {s.kind === 'ticket' && (
        <div className="text-center">
          <div className="border-mkt-line mx-auto grid size-24 grid-cols-5 grid-rows-5 gap-0.5 rounded-md border bg-white p-2">
            {Array.from({ length: 25 }).map((_, i) => (
              <span key={i} className={(i * 7) % 3 === 0 ? 'bg-mkt-ink rounded-[1px]' : ''} />
            ))}
          </div>
          <p className="text-mkt-ink mt-2 font-[family-name:var(--font-geist-mono)] text-xs">
            {s.code}
          </p>
          <p className="mt-1 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            {s.status}
          </p>
        </div>
      )}
      {s.kind === 'payout' && (
        <ul className="space-y-2">
          {s.rows.map((r, i) => (
            <li
              key={r[0]}
              className={
                i === s.rows.length - 1
                  ? 'border-mkt-line text-mkt-ink mt-1 flex items-center justify-between border-t pt-2 text-sm font-semibold'
                  : 'text-mkt-slate flex items-center justify-between text-sm'
              }
            >
              <span>{r[0]}</span>
              <span className={i === s.rows.length - 1 ? 'text-mkt-red' : 'text-mkt-ink'}>
                {r[1]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function DemoPage() {
  return (
    <>
      <MarketingNavbar />

      <section className="mkt-hero border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center md:py-24">
          <p className="text-mkt-red text-xs font-semibold tracking-[0.18em] uppercase">
            Live demo · <Bn>লাইভ ডেমো</Bn>
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            One event, end to end — in about 90 seconds.
          </h1>
          <p className="text-mkt-slate mt-4 text-base leading-relaxed">
            No sign-up. Follow a real concert from the organiser’s first click to the payout that
            lands five days later. This is exactly what your event would do.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/sign-up"
              className="bg-mkt-red inline-flex h-12 items-center rounded-lg px-7 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--color-mkt-red-dark)] hover:shadow-md"
            >
              Try it on your event
            </Link>
            <Link
              href="/pricing"
              className="border-mkt-line text-mkt-ink inline-flex h-12 items-center rounded-lg border bg-white px-7 text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-sm"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-5xl px-6 py-16 md:py-20">
          <ol className="space-y-10">
            {STAGES.map((stage) => (
              <li key={stage.n} className="grid gap-6 md:grid-cols-2 md:items-center">
                <div
                  className={
                    stage.n.endsWith('2') || stage.n.endsWith('4') || stage.n.endsWith('6')
                      ? 'md:order-2'
                      : ''
                  }
                >
                  <div className="flex items-center gap-3">
                    <span className="text-mkt-red text-3xl font-bold">{stage.n}</span>
                    <span className="border-mkt-line text-mkt-slate rounded-full border px-2.5 py-0.5 font-[family-name:var(--font-geist-mono)] text-xs">
                      {stage.t}
                    </span>
                  </div>
                  <h2 className="mt-3 text-2xl font-bold tracking-tight">{stage.title}</h2>
                  <p className="text-mkt-red mt-1 text-sm font-medium">
                    <Bn>{stage.bn}</Bn>
                  </p>
                  <p className="text-mkt-slate mt-3 text-sm leading-relaxed">{stage.body}</p>
                </div>
                <Screen s={stage.screen} />
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mkt-hero border-t border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center md:py-20">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">That’s the whole loop.</h2>
          <p className="text-mkt-slate mt-3 text-base leading-relaxed">
            Free events are live in 90 seconds. Paid events add a quick KYC step, then sell.
          </p>
          <div className="mt-7">
            <Link
              href="/sign-up"
              className="bg-mkt-red inline-flex h-12 items-center rounded-lg px-7 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--color-mkt-red-dark)] hover:shadow-md"
            >
              Create your first event
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </>
  )
}

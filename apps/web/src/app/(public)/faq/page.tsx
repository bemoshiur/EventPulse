import type { Metadata } from 'next'
import Link from 'next/link'

import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'
import { FaqJsonLd } from '@/components/seo/structured-data'

export const metadata: Metadata = {
  title: 'FAQ',
  description:
    'Answers about Event Pulse — pricing, KYC, payouts, payments, custom domains, data security, and getting started selling tickets in Bangladesh.',
  alternates: { canonical: '/faq' },
}

const GROUPS = [
  {
    heading: 'Getting started',
    items: [
      {
        q: 'What is Event Pulse?',
        a: 'A multi-tenant event ticketing and registration platform for Bangladesh, by Public Pulse Agency. Create a branded event page, design a custom form, sell tickets via EPS, check attendees in by QR, and receive automated payouts — all in one place.',
      },
      {
        q: 'How do I sign in?',
        a: 'With a one-time email link (magic link). There are no passwords and no third-party logins to manage — you enter your email, we send a link, you click it, you’re in.',
      },
      {
        q: 'Do I need KYC to start?',
        a: 'No. You can publish free RSVP events with no verification at all. KYC is required only the moment you add a paid ticket tier — because that’s when we verify you to handle money on your behalf.',
      },
      {
        q: 'How fast can I publish?',
        a: 'A free event can go live in under 90 seconds: sign in, pick a type, fill the basics, publish. Paid events add a quick KYC step before tickets go on sale.',
      },
    ],
  },
  {
    heading: 'Money & payouts',
    items: [
      {
        q: 'What does Event Pulse cost?',
        a: 'A flat 0.25% platform fee per paid transaction — no setup fee, no monthly minimum, no subscription. EPS gateway fees pass through at cost. Free events cost nothing.',
      },
      {
        q: 'When do I get paid?',
        a: 'Net proceeds settle to your bank account (BEFTN) or MFS wallet (bKash, Nagad, Rocket, Upay) five business days after each transaction (T+5), with a full statement of gross, fees, and refunds.',
      },
      {
        q: 'Who pays the fees — me or the buyer?',
        a: 'Your choice, per event. “Absorb” deducts fees from your payout so the buyer sees one clean price; “pass-through” adds them on top at checkout so you keep the full face value. The transparency calculator on the Pricing page shows every combination.',
      },
      {
        q: 'How do refunds work?',
        a: 'Refunds are built in. The organiser initiates a refund; it’s reflected in reconciliation and the next settlement. Money always moves through EPS, never a personal account.',
      },
    ],
  },
  {
    heading: 'Payments & security',
    items: [
      {
        q: 'How do buyers pay?',
        a: 'Through EPS hosted checkout — bKash at launch, with more methods following. Every payment is verified server-side with EPS after the buyer returns; we never trust the redirect parameters.',
      },
      {
        q: 'Is my buyers’ data safe?',
        a: 'Buyer and KYC data is encrypted at rest with managed keys, isolated per tenant, and never used to train any third-party model. KYC documents live in encrypted storage accessible only to the review queue. See the Trust Center for the full stance.',
      },
      {
        q: 'Can I use my own domain and branding?',
        a: 'Yes. Every event page carries your logo and colours, and KYC-verified organisers can connect a custom domain so the whole experience lives on your brand.',
      },
    ],
  },
] as const

const ALL: { q: string; a: string }[] = GROUPS.flatMap((g) =>
  g.items.map((i) => ({ q: i.q, a: i.a })),
)

export default function FaqPage() {
  return (
    <>
      <MarketingNavbar />

      <section className="mkt-hero border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center md:py-20">
          <p className="text-mkt-red text-xs font-semibold tracking-[0.18em] uppercase">FAQ</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            Everything you need to know.
          </h1>
          <p className="text-mkt-slate mt-4 text-base leading-relaxed">
            Can’t find your question?{' '}
            <Link href="/contact" className="text-mkt-red font-semibold hover:underline">
              Talk to us
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-6 py-16 md:py-20">
          {GROUPS.map((g) => (
            <div key={g.heading} className="mb-12 last:mb-0">
              <h2 className="text-mkt-slate mb-4 text-xs font-semibold tracking-[0.18em] uppercase">
                {g.heading}
              </h2>
              <div className="space-y-3">
                {g.items.map((f) => (
                  <details key={f.q} className="mkt-card group p-5">
                    <summary className="flex cursor-pointer list-none items-center justify-between text-left text-base font-semibold">
                      {f.q}
                      <span
                        aria-hidden="true"
                        className="text-mkt-red ml-4 transition-transform group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <p className="text-mkt-slate mt-3 text-sm leading-relaxed">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <FaqJsonLd items={ALL} />
      <MarketingFooter />
    </>
  )
}

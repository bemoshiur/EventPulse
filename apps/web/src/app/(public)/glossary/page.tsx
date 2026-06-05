import type { Metadata } from 'next'

import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'

export const metadata: Metadata = {
  title: 'Glossary — event ticketing & payments terms',
  description:
    'Plain-language definitions of the terms you’ll meet running events in Bangladesh — EPS, KYC, T+5, MFS, BEFTN, ticket tiers, escrow, and more.',
  alternates: { canonical: '/glossary' },
}

interface Term {
  term: string
  abbr?: string
  def: string
}

const GROUPS: { heading: string; terms: Term[] }[] = [
  {
    heading: 'Money & payments',
    terms: [
      {
        term: 'EPS',
        abbr: 'Easy Payment System',
        def: 'The Bangladesh payment gateway Event Pulse uses for checkout. Buyers pay through EPS hosted checkout (bKash at launch); payment status is always confirmed server-side with EPS, never trusted from the browser redirect.',
      },
      {
        term: 'MFS',
        abbr: 'Mobile Financial Service',
        def: 'Mobile wallets like bKash, Nagad, Rocket, and Upay. Buyers can pay by MFS, and organisers can receive payouts to an MFS wallet.',
      },
      {
        term: 'BEFTN',
        abbr: 'Bangladesh Electronic Funds Transfer Network',
        def: 'The bank-to-bank transfer rail used to settle payouts to an organiser’s bank account.',
      },
      {
        term: 'T+5',
        def: 'The payout schedule: net proceeds settle to your account five business days after each transaction. Funds sit in escrow until then.',
      },
      {
        term: 'Escrow',
        def: 'Collected ticket money is held separately from any personal or operating account until it settles to the organiser on the T+5 schedule — so funds are protected in between.',
      },
      {
        term: 'Platform fee',
        def: 'Event Pulse’s flat 0.25% per paid transaction — published, with no setup fee or monthly minimum. Free events pay nothing.',
      },
      {
        term: 'Gateway fee',
        def: 'The fee EPS charges to process a payment. It passes through at cost — Event Pulse never marks it up.',
      },
      {
        term: 'Absorb vs pass-through',
        def: 'Per event, you choose who carries the fees. Absorb deducts them from your payout (buyer sees one clean price); pass-through adds them at checkout (you keep the full face value).',
      },
      {
        term: 'Settlement statement',
        def: 'The breakdown that accompanies each payout — gross sales, platform fee, gateway fees, refunds, and the net amount you receive.',
      },
    ],
  },
  {
    heading: 'Verification & compliance',
    terms: [
      {
        term: 'KYC',
        abbr: 'Know Your Customer',
        def: 'The identity check required before you can sell paid tickets. Free events need no KYC; it’s only triggered when you add a paid ticket tier, because that’s when money is handled on your behalf.',
      },
      {
        term: 'NID',
        abbr: 'National ID',
        def: 'The Bangladesh national identity card, used as part of individual KYC and (optionally) collected on registration forms for regulated events.',
      },
      {
        term: 'eTIN',
        def: 'Electronic Taxpayer Identification Number — part of organisation KYC for tax purposes.',
      },
      {
        term: 'BFIU',
        abbr: 'Bangladesh Financial Intelligence Unit',
        def: 'The regulator whose rules drive KYC and record-keeping. KYC documentation is retained for five years under BFIU requirements.',
      },
      {
        term: 'Audit log',
        def: 'An append-only record of every state-changing action (who did what, when, from where). Used for security, dispute resolution, and compliance.',
      },
    ],
  },
  {
    heading: 'Events & tickets',
    terms: [
      {
        term: 'Ticket tier',
        def: 'A category of ticket with its own price, capacity, and sales window — e.g. General, VIP, Front row, Student.',
      },
      {
        term: 'Free event',
        def: 'An event where every tier is free (price 0). It publishes instantly with no KYC and no fees; attendees still get QR tickets and check-in.',
      },
      {
        term: 'Capacity',
        def: 'The maximum number of tickets available — per tier and/or for the whole event. Sold-out states are handled automatically.',
      },
      {
        term: 'Sales window',
        def: 'The start and end time during which a tier is on sale.',
      },
      {
        term: 'QR ticket',
        def: 'The unique QR code emailed to each attendee. It’s scanned at the gate, instant and de-duplicated, so it can’t be reused if forwarded.',
      },
      {
        term: 'Check-in',
        def: 'Admitting an attendee at the gate by scanning their QR from any phone browser — no app, offline-tolerant, and gate-by-gate.',
      },
      {
        term: 'Registration form',
        def: 'The custom form a buyer fills at checkout. You choose the fields (text, NID, file upload, dropdowns) and the conditional logic.',
      },
    ],
  },
  {
    heading: 'Accounts & roles',
    terms: [
      {
        term: 'Organiser (tenant)',
        def: 'The account that hosts events. Each organiser’s data is isolated from every other organiser’s. A personal organiser space is created automatically the first time you host.',
      },
      {
        term: 'Magic link',
        def: 'The one-time sign-in link emailed to you. Event Pulse uses magic links instead of passwords — there’s nothing to remember or leak.',
      },
      {
        term: 'Custom domain',
        def: 'Your own web address for your event pages, available once KYC-verified, so the experience lives entirely on your brand.',
      },
      {
        term: 'Team roles',
        def: 'Scoped access for your team — owner, editor, scanner, finance — so a gate volunteer can check people in without seeing your financial reports.',
      },
    ],
  },
]

export default function GlossaryPage() {
  return (
    <>
      <MarketingNavbar />

      <section className="mkt-hero border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center md:py-20">
          <p className="text-mkt-red text-xs font-semibold tracking-[0.18em] uppercase">
            Glossary · <span lang="bn">শব্দকোষ</span>
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            Every term, in plain language.
          </h1>
          <p className="text-mkt-slate mt-4 text-base leading-relaxed">
            The acronyms and jargon you’ll meet running events and taking payments in Bangladesh —
            defined simply.
          </p>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-4xl px-6 py-16 md:py-20">
          {GROUPS.map((g) => (
            <div key={g.heading} className="mb-12 last:mb-0">
              <h2 className="text-mkt-slate mb-5 text-xs font-semibold tracking-[0.18em] uppercase">
                {g.heading}
              </h2>
              <dl className="space-y-4">
                {g.terms.map((t) => (
                  <div key={t.term} className="border-mkt-line rounded-2xl border bg-white p-5">
                    <dt className="flex flex-wrap items-baseline gap-2">
                      <span className="text-mkt-ink text-base font-semibold">{t.term}</span>
                      {t.abbr ? <span className="text-mkt-slate text-sm">— {t.abbr}</span> : null}
                    </dt>
                    <dd className="text-mkt-slate mt-2 text-sm leading-relaxed">{t.def}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>

      <MarketingFooter />
    </>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'

import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'

export const metadata: Metadata = {
  title: 'Features — Event Pulse',
  description:
    'Branded landing pages, custom registration forms, bKash checkout, QR tickets, web-based check-in, automated T+5 disbursement, and a super-admin queue for trust and safety.',
}

const SECTIONS = [
  {
    eyebrow: 'For organisers',
    title: 'Build the event surface, end-to-end.',
    features: [
      {
        title: 'Branded landing pages',
        body: 'Custom logo, colours, and banner image. Bilingual EN+BN copy fields. Subdomain at launch; custom domain when KYC clears.',
      },
      {
        title: 'Custom registration forms',
        body: 'Text, email, phone, NID, file uploads, dropdowns, radio, dates. Conditional logic and per-tier variations. The same form engine powers the public form and the builder.',
      },
      {
        title: 'Multiple ticket tiers',
        body: 'Set capacity, sales window, per-order limits. Complimentary tiers for guest lists. Sold-out states handled automatically.',
      },
      {
        title: 'Coupon codes (Phase 2)',
        body: 'Percentage or fixed discounts. Limit by tier, per-user cap, expiry windows. Drop-in for marketing campaigns.',
      },
    ],
  },
  {
    eyebrow: 'For buyers',
    title: 'A checkout that respects the buyer.',
    features: [
      {
        title: 'bKash checkout at launch',
        body: 'Buyers pay via bKash through EPS hosted checkout. Card and other methods rolling out week 1 post-launch. Free events skip payment entirely.',
      },
      {
        title: 'QR ticket by email',
        body: 'Every attendee gets a PDF ticket with a unique QR code, delivered automatically. Resends from the buyer’s account or by the organiser.',
      },
      {
        title: 'Bilingual public pages',
        body: 'Event titles, descriptions, and ticket information render in both Bangla and English. Buyer-facing strings honour the buyer’s language preference.',
      },
      {
        title: 'Transparent fees',
        body: 'Every line item is itemised before the buyer commits. The fee mode (absorb vs pass-through) is the organiser’s choice; the disclosure is non-negotiable.',
      },
    ],
  },
  {
    eyebrow: 'At the gate',
    title: 'Check-in without an app.',
    features: [
      {
        title: 'Web QR scanner',
        body: 'Any modern browser — phone or laptop — is a scanner. No native app to install, no scanner hardware to procure.',
      },
      {
        title: 'Offline-tolerant',
        body: 'Scans queue locally when the gate has spotty connectivity. Sync resumes automatically when the device reconnects.',
      },
      {
        title: 'Multi-gate aware',
        body: 'Tag each scan with a gate label so post-event reports show who entered through which door.',
      },
      {
        title: 'Role-scoped access',
        body: 'Scanner-only team members can check in attendees without ever seeing your financial reports.',
      },
    ],
  },
  {
    eyebrow: 'Money',
    title: 'Automated T+5 disbursement.',
    features: [
      {
        title: 'Flat 0.25% platform fee',
        body: 'Published, predictable, audited. Per-tenant overrides available for enterprise customers via support.',
      },
      {
        title: 'Two fee modes',
        body: 'Absorb or pass-through, choose per event. The transparency calculator on the Pricing page walks through every combination.',
      },
      {
        title: 'Per-tenant payout accounts',
        body: 'Bank (BEFTN) at launch. bKash, Nagad, Rocket B2C adapters in Phase 2.',
      },
      {
        title: 'Reconciliation built-in',
        body: 'Daily EPS settlement import. Every batch is verified against two invariants before the payout is released.',
      },
    ],
  },
  {
    eyebrow: 'Trust and safety',
    title: 'A platform that takes the host-liability framing seriously.',
    features: [
      {
        title: 'Report button on every event',
        body: 'Attendees and the public can report events that violate our Acceptable Use Policy. 24-hour SLA for high and critical categories.',
      },
      {
        title: 'KYC tiered to scale',
        body: 'Free events skip KYC. Paid events go through individual or organisation KYC before tickets go live. Limits scale with tier.',
      },
      {
        title: 'Encrypted KYC documents',
        body: 'KYC docs live in S3 behind a dedicated KMS CMK, accessible only to the review queue. Per CLAUDE.md §1.3 R4.',
      },
      {
        title: 'Audit trail by default',
        body: 'Every state change writes to audit_logs with actor, target, before/after, IP, user agent. 5-year retention per BFIU.',
      },
    ],
  },
] as const

export default function FeaturesPage() {
  return (
    <>
      <MarketingNavbar current="features" />

      <section className="relative">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center md:py-24">
          <p className="text-mkt-red text-xs font-semibold tracking-widest uppercase">Features</p>
          <h1 className="text-mkt-ink mt-3 text-3xl font-semibold md:text-5xl">
            Everything you need to sell a ticket.
          </h1>
          <p className="text-mkt-slate mt-4 text-base leading-relaxed">
            Built around the operational realities of running events in Bangladesh — bKash-first
            payments, bilingual UI, BFIU-grade audit trails, and a settlement engine that pays you
            in five days.
          </p>
        </div>
      </section>

      {SECTIONS.map((section) => (
        <section key={section.title} className="relative">
          <div className="mx-auto max-w-6xl px-6 pb-16 md:pb-24">
            <header className="mb-10">
              <p className="text-mkt-red text-xs font-semibold tracking-widest uppercase">
                {section.eyebrow}
              </p>
              <h2 className="text-mkt-ink mt-2 text-2xl font-semibold md:text-3xl">
                {section.title}
              </h2>
            </header>

            <div className="grid gap-5 md:grid-cols-2">
              {section.features.map((feature) => (
                <div key={feature.title} className="mkt-card p-7">
                  <h3 className="text-mkt-ink text-base font-semibold">{feature.title}</h3>
                  <p className="text-mkt-slate mt-2 text-sm leading-relaxed">{feature.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}

      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 pb-24 text-center">
          <h2 className="text-mkt-ink text-2xl font-semibold md:text-3xl">
            See what 0.25% looks like for your event.
          </h2>
          <p className="text-mkt-slate mt-3 text-sm leading-relaxed">
            Run the numbers on the Pricing page, then sign up to publish.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/pricing"
              className="border-mkt-line text-mkt-ink inline-flex h-11 items-center rounded-md border bg-white/70 px-7 text-sm font-semibold backdrop-blur transition hover:-translate-y-0.5 hover:shadow-sm"
            >
              Pricing calculator
            </Link>
            <Link
              href="/sign-up"
              className="bg-mkt-red inline-flex h-11 items-center rounded-md px-7 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              Get started
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </>
  )
}

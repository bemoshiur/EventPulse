import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { GlassCard } from '@/components/ui/glass-card'
import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'

export const metadata: Metadata = {
  title: 'Features — Event Pulse',
  description:
    'Branded event pages, custom registration forms, EPS checkout, QR tickets, web check-in, automated T+5 payouts, and BFIU-grade audit trails — everything you need to sell a ticket in Bangladesh.',
}

function Bn({ children }: { children: ReactNode }) {
  return (
    <span lang="bn" className="font-[family-name:var(--font-bangla)]">
      {children}
    </span>
  )
}

const SECTIONS = [
  {
    eyebrow: 'For organisers',
    eyebrowBn: 'আয়োজকদের জন্য',
    title: 'Build the event surface, end to end.',
    features: [
      {
        title: 'Branded landing pages',
        body: 'Custom logo, colours, and banner image. Bilingual EN + বাংলা copy fields. A subdomain at launch; your own custom domain once KYC clears.',
      },
      {
        title: 'Custom registration forms',
        body: 'Text, email, phone, NID, file uploads, dropdowns, radio, dates. Conditional logic and per-tier variations. One form engine powers both the builder and the live form.',
      },
      {
        title: 'Multiple ticket tiers',
        body: 'Set capacity, sales window, and per-order limits. Complimentary tiers for guest lists. Sold-out states handled automatically.',
      },
      {
        title: 'Coupons & discounts',
        body: 'Percentage or fixed discounts, limited by tier, with per-user caps and expiry windows. Drop-in for any marketing campaign.',
      },
    ],
  },
  {
    eyebrow: 'For buyers',
    eyebrowBn: 'ক্রেতাদের জন্য',
    title: 'A checkout that respects the buyer.',
    features: [
      {
        title: 'EPS checkout',
        body: 'Buyers pay via bKash through EPS hosted checkout — money never touches a personal wallet. Card and more methods follow post-launch. Free events skip payment entirely.',
      },
      {
        title: 'QR ticket by email',
        body: 'Every attendee gets a PDF ticket with a unique QR code, delivered automatically. Re-send from the buyer’s account or by the organiser at any time.',
      },
      {
        title: 'Bilingual public pages',
        body: 'Event titles, descriptions, and ticket info render in both বাংলা and English. Buyer-facing strings honour the buyer’s language preference.',
      },
      {
        title: 'Transparent fees',
        body: 'Every line item is itemised before the buyer commits. The fee mode — absorb vs pass-through — is your choice; the disclosure is non-negotiable.',
      },
    ],
  },
  {
    eyebrow: 'At the gate',
    eyebrowBn: 'গেটে',
    title: 'Check-in without an app.',
    features: [
      {
        title: 'Web QR scanner',
        body: 'Any modern browser — phone or laptop — is a scanner. No native app to install, no scanner hardware to procure.',
      },
      {
        title: 'Offline-tolerant',
        body: 'Scans queue locally when the gate has spotty connectivity, and sync resumes automatically the moment the device reconnects.',
      },
      {
        title: 'Multi-gate aware',
        body: 'Tag each scan with a gate label so post-event reports show exactly who entered through which door.',
      },
      {
        title: 'Role-scoped access',
        body: 'Scanner-only team members check attendees in without ever seeing your financial reports.',
      },
    ],
  },
  {
    eyebrow: 'Money',
    eyebrowBn: 'টাকা',
    title: 'Automated T+5 payouts you can trust.',
    features: [
      {
        title: 'Flat 0.25% platform fee',
        body: 'Published, predictable, audited. Per-tenant overrides available for enterprise customers via support.',
      },
      {
        title: 'Two fee modes',
        body: 'Absorb or pass-through, chosen per event. The transparency calculator on the Pricing page walks through all four combinations.',
      },
      {
        title: 'Per-tenant payout accounts',
        body: 'Bank (BEFTN) at launch. bKash, Nagad, Rocket, and Upay B2C adapters in Phase 2.',
      },
      {
        title: 'Reconciliation built in',
        body: 'Daily EPS settlement import. Every batch is verified against two ledger invariants before a payout is released.',
      },
    ],
  },
  {
    eyebrow: 'Trust & safety',
    eyebrowBn: 'নিরাপত্তা',
    title: 'A platform that takes host-liability seriously.',
    features: [
      {
        title: 'Report button on every event',
        body: 'Attendees and the public can report events that violate our Acceptable Use Policy. 24-hour SLA for high and critical categories.',
      },
      {
        title: 'KYC tiered to scale',
        body: 'Free events skip KYC. Paid events graduate through individual or organisation KYC before tickets go live, with limits that scale by tier.',
      },
      {
        title: 'Encrypted KYC documents',
        body: 'KYC docs live in encrypted object storage behind a dedicated managed key, accessible only to the review queue. Never a public URL.',
      },
      {
        title: 'Audit trail by default',
        body: 'Every state change writes an audit record — actor, target, before/after, IP, user agent — with 5-year retention per BFIU.',
      },
    ],
  },
] as const

const FLOW = [
  {
    n: '01',
    title: 'Buyer registers',
    body: 'They open your branded page, fill your custom form, and pick a ticket tier — in Bangla or English.',
  },
  {
    n: '02',
    title: 'Pays via EPS',
    body: 'Hosted checkout takes the payment. We verify it server-side with EPS — never trusting the redirect.',
  },
  {
    n: '03',
    title: 'Gets a QR ticket',
    body: 'A PDF ticket with a unique QR lands in their inbox instantly. You scan it at the gate.',
  },
  {
    n: '04',
    title: 'You’re paid T+5',
    body: 'Net proceeds settle to your account five business days later, with a full statement.',
  },
] as const

const FAQS = [
  {
    q: 'Do I need a developer to set this up?',
    a: 'No. Everything — the page, the form, the ticket tiers, the gate — is point-and-click. If you can fill a Google Form, you can run an event on Event Pulse.',
  },
  {
    q: 'Can my whole team work on one event?',
    a: 'Yes. Invite team members with role-scoped access — owner, admin, editor, scanner, or finance — so each person sees exactly what they should and nothing more.',
  },
  {
    q: 'What happens to free events?',
    a: 'Free events publish instantly with no KYC and no fees. They get the same branded pages, QR tickets, and web check-in as paid events — money is simply never involved.',
  },
] as const

export default function FeaturesPage() {
  return (
    <>
      <MarketingNavbar current="features" />

      {/* Hero */}
      <section className="relative">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center md:py-24">
          <p className="text-xs font-semibold tracking-widest text-[var(--color-mkt-red)] uppercase">
            Features · <Bn>ফিচার</Bn>
          </p>
          <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--color-mkt-ink)] md:text-5xl">
            Everything you need to sell a ticket.
          </h1>
          <p className="mt-4 text-lg font-medium text-[var(--color-mkt-slate)]">
            <Bn>একটি টিকিট বিক্রির জন্য যা যা দরকার — সবকিছু এক জায়গায়।</Bn>
          </p>
          <p className="mt-4 text-base leading-relaxed text-[var(--color-mkt-slate)]">
            Built around the operational reality of running events in Bangladesh — EPS payments,
            bilingual pages, BFIU-grade audit trails, and a settlement engine that pays you in five
            days.
          </p>
        </div>
      </section>

      {/* Feature sections */}
      {SECTIONS.map((section) => (
        <section key={section.title} className="relative">
          <div className="mx-auto max-w-6xl px-6 pb-16 md:pb-20">
            <header className="mb-10">
              <p className="text-xs font-semibold tracking-widest text-[var(--color-mkt-red)] uppercase">
                {section.eyebrow} · <Bn>{section.eyebrowBn}</Bn>
              </p>
              <h2 className="font-display mt-2 text-2xl font-semibold text-[var(--color-mkt-ink)] md:text-3xl">
                {section.title}
              </h2>
            </header>

            <div className="grid gap-5 md:grid-cols-2">
              {section.features.map((feature) => (
                <GlassCard key={feature.title} className="p-7">
                  <h3 className="text-base font-semibold text-[var(--color-mkt-ink)]">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-mkt-slate)]">
                    {feature.body}
                  </p>
                </GlassCard>
              ))}
            </div>
          </div>
        </section>
      ))}

      {/* The flow */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-6 pb-16 md:pb-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold tracking-widest text-[var(--color-mkt-red)] uppercase">
              How a sale flows · <Bn>বিক্রির ধাপ</Bn>
            </p>
            <h2 className="font-display mt-2 text-2xl font-semibold text-[var(--color-mkt-ink)] md:text-3xl">
              From your buyer’s tap to your bank account.
            </h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {FLOW.map((f) => (
              <div
                key={f.n}
                className="rounded-2xl border border-[var(--color-mkt-line)]/70 bg-[var(--color-mkt-paper)]/60 p-6 backdrop-blur"
              >
                <span className="ep-gradient-text font-display text-3xl font-bold">{f.n}</span>
                <h3 className="font-display mt-3 text-lg font-semibold text-[var(--color-mkt-ink)]">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-mkt-slate)]">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 pb-16 md:pb-20">
          <div className="text-center">
            <p className="text-xs font-semibold tracking-widest text-[var(--color-mkt-red)] uppercase">
              FAQ
            </p>
            <h2 className="font-display mt-2 text-2xl font-semibold text-[var(--color-mkt-ink)] md:text-3xl">
              Common questions.
            </h2>
          </div>
          <div className="mt-8 space-y-3">
            {FAQS.map((f) => (
              <details
                key={f.q}
                className="group rounded-xl border border-[var(--color-mkt-line)]/70 bg-[var(--color-mkt-paper)]/60 p-5 backdrop-blur"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between text-left text-base font-semibold text-[var(--color-mkt-ink)]">
                  {f.q}
                  <span
                    aria-hidden="true"
                    className="ml-4 text-[var(--color-mkt-red)] transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-mkt-slate)]">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 pb-24 text-center">
          <h2 className="font-display text-2xl font-semibold text-[var(--color-mkt-ink)] md:text-3xl">
            See what 0.25% looks like for your event.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-mkt-slate)]">
            Run the numbers on the Pricing page, then sign up to publish — free events go live in
            under 90 seconds.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/pricing"
              className="inline-flex h-11 items-center rounded-md border border-[var(--color-mkt-line)] bg-[var(--color-mkt-paper)]/70 px-7 text-sm font-semibold text-[var(--color-mkt-ink)] backdrop-blur transition hover:-translate-y-0.5 hover:shadow-sm"
            >
              Pricing calculator
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex h-11 items-center rounded-md bg-gradient-to-r from-[var(--color-mkt-red)] to-[var(--color-mkt-red)] px-7 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
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

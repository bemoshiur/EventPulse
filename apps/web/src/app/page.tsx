import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { GlassCard } from '@/components/ui/glass-card'
import { GradientMesh } from '@/components/ui/gradient-mesh'
import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'

export const metadata: Metadata = {
  title: 'Event Pulse — Run your event. Get paid in 5 days.',
  description:
    'The multi-tenant event ticketing platform built for Bangladesh. Branded event pages, custom registration forms, EPS checkout, QR check-in, and automated T+5 payouts — at a transparent 0.25% fee.',
  openGraph: {
    title: 'Event Pulse — Run your event. Get paid in 5 days.',
    description:
      'Branded event pages, custom forms, EPS checkout, QR check-in, automated T+5 payouts. Built for Bangladesh.',
    type: 'website',
  },
}

/** Bangla text rendered in Hind Siliguri (the bilingual pairing font). */
function Bn({ children }: { children: ReactNode }) {
  return (
    <span lang="bn" className="font-[family-name:var(--font-bangla)]">
      {children}
    </span>
  )
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-widest text-[var(--ep-violet)] uppercase">
      {children}
    </p>
  )
}

const SECTORS = [
  'Concert promoters',
  'Universities',
  'Alumni associations',
  'Tech conferences',
  'NGOs & nonprofits',
  'Corporate events',
  'Comedy clubs',
  'Sports leagues',
] as const

const PROBLEMS = [
  {
    title: 'Registration lives in spreadsheets.',
    bn: 'রেজিস্ট্রেশন স্প্রেডশিটে আটকে',
    body: 'Google Forms for sign-ups, bKash screenshots for payment, a WhatsApp group for the guest list. Reconciling who actually paid eats the days you needed for the event itself.',
  },
  {
    title: 'Money moves through personal accounts.',
    bn: 'টাকা চলে ব্যক্তিগত অ্যাকাউন্টে',
    body: 'Collections land in someone’s personal bKash with no audit trail, no settlement schedule, and no clean way to split fees or refund a buyer. Trust breaks before the event starts.',
  },
  {
    title: 'The gate is chaos. Tickets get faked.',
    bn: 'গেটে বিশৃঙ্খলা, ভুয়া টিকিট',
    body: 'Screenshot “tickets” get forwarded and reused. Volunteers check names against a printed list while a queue builds. You have no idea who showed up until it’s over.',
  },
] as const

const PILLARS = [
  {
    kicker: 'Sell anywhere',
    title: 'Branded pages. Custom forms. Your domain.',
    body: 'Spin up a beautiful event page with your logo and colours, design the exact registration form you need — text, NID, file upload, conditional logic — and put it on your own domain. Share one link, sell everywhere.',
  },
  {
    kicker: 'Run with your team',
    title: 'Roles, an attendee CRM, and a web check-in scanner.',
    body: 'Invite your team with the right access — owner, editor, scanner, finance. Search and export attendees. At the gate, scan QR tickets from any phone browser; every check-in is instant and de-duplicated.',
  },
  {
    kicker: 'Get paid safely',
    title: 'EPS checkout, escrow, and automated T+5 payouts.',
    body: 'Buyers pay through EPS hosted checkout — never a personal wallet. Funds sit in escrow, and net proceeds settle to your bank or MFS account five business days after each sale. Refunds and reconciliation are built in.',
  },
] as const

const USE_CASES = [
  {
    title: 'Concerts & live shows',
    bn: 'কনসার্ট ও লাইভ শো',
    body: 'Multiple ticket tiers, capacity caps, sales windows, and a fast gate. Sell thousands of tickets without your page falling over.',
  },
  {
    title: 'Conferences & summits',
    bn: 'কনফারেন্স ও সামিট',
    body: 'Collect designations, organisations, and dietary needs on custom forms. Per-tier pricing for delegates, students, and sponsors.',
  },
  {
    title: 'Workshops & training',
    bn: 'ওয়ার্কশপ ও প্রশিক্ষণ',
    body: 'Small-group caps, waitlists, and per-session check-in. Take registrations for a free or paid cohort in minutes.',
  },
  {
    title: 'Alumni & reunions',
    bn: 'অ্যালামনাই ও পুনর্মিলনী',
    body: 'Batch-wise pricing, family add-ons, and a clean guest list. Let your committee manage it together with shared access.',
  },
  {
    title: 'Sports & tournaments',
    bn: 'খেলাধুলা ও টুর্নামেন্ট',
    body: 'Team and spectator tickets, gate-wise check-in, and day-of capacity tracking across multiple entries.',
  },
  {
    title: 'Community & meetups',
    bn: 'কমিউনিটি ও মিটআপ',
    body: 'Free RSVP events publish instantly with no verification. Graduate to paid tickets the moment you’re ready to charge.',
  },
] as const

const STEPS = [
  {
    n: '01',
    title: 'Create your event.',
    bn: 'ইভেন্ট তৈরি করুন',
    body: 'Sign up with your email, pick an event type, and fill in the basics. A branded page is generated for you. Free events go live immediately — no verification.',
  },
  {
    n: '02',
    title: 'Open ticket sales.',
    bn: 'টিকিট বিক্রি শুরু করুন',
    body: 'Add ticket tiers with prices, capacity, and sales windows. The moment you add a paid tier, a quick KYC step verifies you to handle money — then publish and share your link.',
  },
  {
    n: '03',
    title: 'Get paid in 5 days.',
    bn: '৫ দিনে টাকা বুঝে নিন',
    body: 'Buyers pay via EPS. Attendees get QR tickets by email. You scan them in at the gate, and net proceeds land in your account T+5 — automatically, with a full statement.',
  },
] as const

const STATS = [
  { value: '90s', label: 'from sign-up to a live event page' },
  { value: '0.25%', label: 'flat platform fee — published, per transaction' },
  { value: 'T+5', label: 'business days to your bank or MFS account' },
  { value: 'EN + বাংলা', label: 'bilingual event pages for every buyer' },
] as const

const FAQS = [
  {
    q: 'What is Event Pulse?',
    a: 'A multi-tenant event ticketing and registration platform for Bangladesh. You create a branded event page, design a custom registration form, sell tickets through EPS, check attendees in by QR, and receive automated payouts — all in one place.',
  },
  {
    q: 'Do I need KYC to start?',
    a: 'No. You can sign up and publish free RSVP events with no verification at all. KYC is only required the moment you add a paid ticket tier — because that’s when we need to verify you to handle money on your behalf.',
  },
  {
    q: 'How fast do I get paid?',
    a: 'Net proceeds settle to your bank account or MFS wallet (bKash, Nagad, Rocket, Upay) five business days after each transaction (T+5). Every payout comes with a clear statement of gross sales, fees, and refunds.',
  },
  {
    q: 'What does it cost?',
    a: 'A flat 0.25% platform fee per paid transaction — no setup fee, no monthly minimum, no subscription. EPS gateway fees pass through at cost. You choose per event whether to absorb fees or pass them to the buyer. Free events cost nothing.',
  },
  {
    q: 'Can I use my own domain and branding?',
    a: 'Yes. Every event page carries your logo and colours, and KYC-verified organisers can connect a custom domain so the whole experience lives on your brand — not ours.',
  },
  {
    q: 'Is my buyers’ data safe?',
    a: 'Buyer and KYC data is encrypted at rest with managed keys, isolated per tenant, and never used to train any third-party model. Payments run through EPS — money never touches a personal wallet. See our Trust Center for the full security stance.',
  },
] as const

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--ep-mist)]">
      <GradientMesh />
      <MarketingNavbar />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative">
        <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-20 text-center md:py-28">
          <span className="ep-reveal inline-flex items-center gap-2 rounded-full bg-[var(--ep-paper)]/70 px-4 py-1.5 text-xs font-medium text-[var(--ep-graphite)] shadow-sm backdrop-blur">
            <span aria-hidden="true" className="size-2 rounded-full bg-[var(--ep-mint)]" />
            Built for Bangladesh · EPS-ready · <Bn>বাংলায়</Bn>
          </span>

          <h1 className="ep-reveal ep-reveal-1 text-hero mt-6 text-[var(--ep-ink)]">
            Run your event. <span className="ep-gradient-text">Get paid in 5 days.</span>
          </h1>

          <p className="ep-reveal ep-reveal-2 mt-5 text-lg font-medium text-[var(--ep-graphite)]">
            <Bn>আপনার ইভেন্ট চালান — ব্র্যান্ডেড পেজ, টিকিট বিক্রি, আর ৫ দিনে টাকা বুঝে নিন।</Bn>
          </p>

          <p className="ep-reveal ep-reveal-3 mt-4 max-w-2xl text-base leading-relaxed text-[var(--ep-graphite)]">
            Event Pulse turns a tender of spreadsheets, bKash screenshots and WhatsApp lists into
            one clean flow: a <strong className="text-[var(--ep-ink)]">branded event page</strong>,
            a custom registration form, EPS checkout, QR check-in, and automated{' '}
            <strong className="text-[var(--ep-ink)]">T+5 payouts</strong> — at a transparent 0.25%.
          </p>

          <div className="ep-reveal ep-reveal-4 mt-9 flex flex-col items-center gap-3 sm:flex-row">
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

          <p className="ep-reveal ep-reveal-4 mt-5 text-xs text-[var(--ep-graphite)]">
            Free events are instant. No setup fee, no monthly minimum. KYC only when you sell paid
            tickets.
          </p>
        </div>
      </section>

      {/* ── Trust bar ────────────────────────────────────────── */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-6 pb-12">
          <p className="text-center text-xs font-semibold tracking-widest text-[var(--ep-graphite)] uppercase">
            Made for every kind of organiser · <Bn>সব আয়োজকের জন্য</Bn>
          </p>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-3">
            {SECTORS.map((s) => (
              <li
                key={s}
                className="rounded-full border border-[var(--ep-line)]/70 bg-[var(--ep-paper)]/60 px-4 py-1.5 text-sm font-medium text-[var(--ep-graphite)] backdrop-blur"
              >
                {s}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Problem ──────────────────────────────────────────── */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>The organiser’s headache</Eyebrow>
            <h2 className="font-display mt-3 text-3xl font-semibold text-[var(--ep-ink)] md:text-4xl">
              Selling tickets in Bangladesh is harder than the event itself.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[var(--ep-graphite)]">
              The work that drains your team isn’t the show — it’s everything around the ticket.
              Here’s what we replace.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {PROBLEMS.map((p) => (
              <GlassCard key={p.title} className="p-7">
                <h3 className="text-lg font-semibold text-[var(--ep-ink)]">{p.title}</h3>
                <p className="mt-1 text-sm font-medium text-[var(--ep-violet)]">
                  <Bn>{p.bn}</Bn>
                </p>
                <p className="mt-3 text-sm leading-relaxed text-[var(--ep-graphite)]">{p.body}</p>
              </GlassCard>
            ))}
          </div>
        </div>
      </section>

      {/* ── Platform pillars ─────────────────────────────────── */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>One platform, end to end</Eyebrow>
            <h2 className="font-display mt-3 text-3xl font-semibold text-[var(--ep-ink)] md:text-4xl">
              Everything from the first ticket to the final payout.
            </h2>
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {PILLARS.map((p) => (
              <GlassCard key={p.kicker} variant="strong" className="p-8">
                <p className="text-xs font-semibold tracking-widest text-[var(--ep-cerulean)] uppercase">
                  {p.kicker}
                </p>
                <h3 className="font-display mt-3 text-xl font-semibold text-[var(--ep-ink)]">
                  {p.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-[var(--ep-graphite)]">{p.body}</p>
              </GlassCard>
            ))}
          </div>
        </div>
      </section>

      {/* ── Use cases ────────────────────────────────────────── */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>Use cases · ব্যবহার</Eyebrow>
            <h2 className="font-display mt-3 text-3xl font-semibold text-[var(--ep-ink)] md:text-4xl">
              Whatever you’re hosting, the same toolkit scales.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[var(--ep-graphite)]">
              From a 30-person workshop to a 5,000-seat concert — one workflow, one fee, one payout.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {USE_CASES.map((u) => (
              <GlassCard key={u.title} className="p-7">
                <h3 className="text-lg font-semibold text-[var(--ep-ink)]">{u.title}</h3>
                <p className="mt-1 text-sm font-medium text-[var(--ep-violet)]">
                  <Bn>{u.bn}</Bn>
                </p>
                <p className="mt-3 text-sm leading-relaxed text-[var(--ep-graphite)]">{u.body}</p>
              </GlassCard>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="font-display mt-3 text-3xl font-semibold text-[var(--ep-ink)] md:text-4xl">
              Live in three steps.
            </h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="relative rounded-2xl border border-[var(--ep-line)]/70 bg-[var(--ep-paper)]/60 p-8 backdrop-blur"
              >
                <span className="ep-gradient-text font-display text-4xl font-bold">{s.n}</span>
                <h3 className="font-display mt-4 text-xl font-semibold text-[var(--ep-ink)]">
                  {s.title}
                </h3>
                <p className="mt-1 text-sm font-medium text-[var(--ep-violet)]">
                  <Bn>{s.bn}</Bn>
                </p>
                <p className="mt-3 text-sm leading-relaxed text-[var(--ep-graphite)]">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Money & trust ────────────────────────────────────── */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <GlassCard variant="strong" className="p-10 md:p-14">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <Eyebrow>Your money, protected</Eyebrow>
                <h2 className="font-display mt-3 text-3xl font-semibold text-[var(--ep-ink)] md:text-4xl">
                  A transparent 0.25%. Funds in escrow. Payouts on a schedule.
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-[var(--ep-graphite)]">
                  Money is the part you can’t get wrong — so it’s the part we engineered hardest.
                  Every taka is tracked from checkout to payout, and you always know exactly what
                  you’ll receive.
                </p>
                <ul className="mt-6 space-y-3">
                  {[
                    'Flat 0.25% platform fee — choose to absorb it or pass it to the buyer, per event.',
                    'EPS gateway fees pass through at cost — we never mark them up.',
                    'Collections held in escrow, separate from any personal account.',
                    'Automated T+5 settlement with a full per-payout statement.',
                    'Built-in refunds and EPS reconciliation — every figure auditable.',
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-3 text-sm text-[var(--ep-ink)]">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--ep-mint)]/20 text-[var(--ep-mint)]"
                      >
                        ✓
                      </span>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-[var(--ep-line)]/70 bg-[var(--ep-paper)]/80 p-6 font-[family-name:var(--font-geist-mono)] text-sm shadow-sm">
                <p className="text-xs font-semibold tracking-widest text-[var(--ep-graphite)] uppercase">
                  Settlement preview · per ৳1,000 ticket
                </p>
                <dl className="mt-4 space-y-2.5">
                  {[
                    ['Ticket face value', '৳1,000.00'],
                    ['Platform fee (0.25%)', '− ৳2.50'],
                    ['EPS gateway (pass-through)', 'buyer pays'],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-center justify-between text-[var(--ep-graphite)]"
                    >
                      <dt>{k}</dt>
                      <dd className="text-[var(--ep-ink)]">{v}</dd>
                    </div>
                  ))}
                  <div className="mt-3 flex items-center justify-between border-t border-[var(--ep-line)] pt-3 text-base font-semibold">
                    <dt className="text-[var(--ep-ink)]">You receive (T+5)</dt>
                    <dd className="text-[var(--ep-mint)]">৳997.50</dd>
                  </div>
                </dl>
                <p className="mt-4 text-xs text-[var(--ep-graphite)]">
                  Illustrative. The live calculator shows every fee mode at checkout.
                </p>
              </div>
            </div>
          </GlassCard>
        </div>
      </section>

      {/* ── Stats band ───────────────────────────────────────── */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="grid gap-px overflow-hidden rounded-2xl border border-[var(--ep-line)]/70 bg-[var(--ep-line)]/40 sm:grid-cols-2 lg:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="bg-[var(--ep-paper)]/80 p-8 text-center backdrop-blur">
                <p className="ep-gradient-text font-display text-4xl font-bold">{s.value}</p>
                <p className="mt-2 text-sm text-[var(--ep-graphite)]">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonial ──────────────────────────────────────── */}
      <section className="relative">
        <div className="mx-auto max-w-4xl px-6 py-16 md:py-20">
          <GlassCard className="p-10 text-center md:p-14">
            <p className="font-display text-2xl leading-relaxed font-medium text-[var(--ep-ink)] md:text-3xl">
              “We used to run alumni registration on three spreadsheets and a personal bKash. With
              Event Pulse, sales, the guest list, and the gate are one link — and the payout just
              arrives.”
            </p>
            <p className="mt-6 text-sm text-[var(--ep-graphite)]">
              Organising committee · university reunion, ~1,200 attendees
            </p>
          </GlassCard>
        </div>
      </section>

      {/* ── Pricing teaser ───────────────────────────────────── */}
      <section className="relative">
        <div className="mx-auto max-w-5xl px-6 py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>Pricing · প্রাইসিং</Eyebrow>
            <h2 className="font-display mt-3 text-3xl font-semibold text-[var(--ep-ink)] md:text-4xl">
              One number. No surprises.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[var(--ep-graphite)]">
              0.25% per paid transaction. Free events are free, forever. EPS gateway fees pass
              through at cost, and you decide who carries them.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/pricing"
                className="inline-flex h-12 items-center rounded-md border border-[var(--ep-line)] bg-[var(--ep-paper)]/70 px-8 text-sm font-semibold text-[var(--ep-ink)] backdrop-blur transition hover:-translate-y-0.5 hover:shadow-sm"
              >
                See the full breakdown
              </Link>
              <Link
                href="/features"
                className="inline-flex h-12 items-center rounded-md px-8 text-sm font-semibold text-[var(--ep-violet)] transition hover:underline"
              >
                Explore all features →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 py-16 md:py-20">
          <div className="text-center">
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="font-display mt-3 text-3xl font-semibold text-[var(--ep-ink)] md:text-4xl">
              Everything you need to know.
            </h2>
          </div>
          <div className="mt-10 space-y-3">
            {FAQS.map((f) => (
              <details
                key={f.q}
                className="group rounded-xl border border-[var(--ep-line)]/70 bg-[var(--ep-paper)]/60 p-5 backdrop-blur"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between text-left text-base font-semibold text-[var(--ep-ink)]">
                  {f.q}
                  <span
                    aria-hidden="true"
                    className="ml-4 text-[var(--ep-violet)] transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-[var(--ep-graphite)]">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────── */}
      <section className="relative">
        <div className="mx-auto max-w-4xl px-6 pb-24 text-center">
          <h2 className="font-display text-3xl font-semibold text-[var(--ep-ink)] md:text-5xl">
            Your next event, live in 90 seconds.
          </h2>
          <p className="mt-4 text-lg text-[var(--ep-graphite)]">
            <Bn>আজই শুরু করুন — ফ্রি ইভেন্ট সঙ্গে সঙ্গে লাইভ।</Bn>
          </p>
          <p className="mt-3 text-base leading-relaxed text-[var(--ep-graphite)]">
            Sign up with your email — free events publish instantly, paid events graduate through a
            quick KYC check before tickets go live.
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
  )
}

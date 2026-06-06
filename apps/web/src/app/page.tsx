import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { AskAiCard } from '@/components/marketing/ask-ai-card'
import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'
import { FaqJsonLd, SoftwareApplicationJsonLd } from '@/components/seo/structured-data'

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

/** Bangla text (the whole marketing surface is Hind Siliguri, so this only marks language). */
function Bn({ children }: { children: ReactNode }) {
  return <span lang="bn">{children}</span>
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-mkt-red text-xs font-semibold tracking-[0.18em] uppercase">{children}</p>
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

const PRIMARY_CTA =
  'bg-mkt-red inline-flex h-12 items-center justify-center rounded-lg px-7 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[var(--color-mkt-red-dark)] hover:shadow-md'
const SECONDARY_CTA =
  'border-mkt-line text-mkt-ink inline-flex h-12 items-center justify-center rounded-lg border bg-white px-7 text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-sm'

export default function HomePage() {
  return (
    <main className="text-mkt-ink min-h-screen bg-white font-[family-name:var(--font-bangla)]">
      <MarketingNavbar />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="mkt-hero relative border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-20 text-center md:py-28">
          <span className="border-mkt-line text-mkt-slate inline-flex items-center gap-2 rounded-full border bg-white px-4 py-1.5 text-xs font-medium shadow-sm">
            <span aria-hidden="true" className="bg-mkt-red size-2 rounded-full" />
            Built for Bangladesh · EPS-ready · <Bn>বাংলায়</Bn>
          </span>

          <h1 className="mt-6 text-4xl font-bold tracking-tight md:text-6xl">
            Run your event. <span className="text-mkt-red">Get paid in 5 days.</span>
          </h1>

          <p className="text-mkt-slate mt-5 text-lg font-medium">
            <Bn>আপনার ইভেন্ট চালান — ব্র্যান্ডেড পেজ, টিকিট বিক্রি, আর ৫ দিনে টাকা বুঝে নিন।</Bn>
          </p>

          <p className="text-mkt-slate mt-4 max-w-2xl text-base leading-relaxed">
            Event Pulse turns a tangle of spreadsheets, bKash screenshots and WhatsApp lists into
            one clean flow: a <strong className="text-mkt-ink">branded event page</strong>, a custom
            registration form, EPS checkout, QR check-in, and automated{' '}
            <strong className="text-mkt-ink">T+5 payouts</strong> — at a transparent 0.25%.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <Link href="/sign-up" className={PRIMARY_CTA}>
              Create your first event
            </Link>
            <Link href="/pricing" className={SECONDARY_CTA}>
              See pricing
            </Link>
          </div>

          <p className="text-mkt-slate mt-5 text-xs">
            Free events are instant. No setup fee, no monthly minimum. KYC only when you sell paid
            tickets.
          </p>
        </div>
      </section>

      {/* ── Trust bar ────────────────────────────────────────── */}
      <section className="border-b border-[var(--color-mkt-line)] bg-white">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <p className="text-mkt-slate text-center text-xs font-semibold tracking-[0.18em] uppercase">
            Made for every kind of organiser · <Bn>সব আয়োজকের জন্য</Bn>
          </p>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-3">
            {SECTORS.map((s) => (
              <li
                key={s}
                className="border-mkt-line text-mkt-slate rounded-full border bg-white px-4 py-1.5 text-sm font-medium"
              >
                {s}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Problem ──────────────────────────────────────────── */}
      <section className="mkt-glow border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>The organiser’s headache</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Selling tickets in Bangladesh is harder than the event itself.
            </h2>
            <p className="text-mkt-slate mt-4 text-base leading-relaxed">
              The work that drains your team isn’t the show — it’s everything around the ticket.
              Here’s what we replace.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {PROBLEMS.map((p) => (
              <div key={p.title} className="mkt-card p-7">
                <h3 className="text-lg font-semibold">{p.title}</h3>
                <p className="text-mkt-red mt-1 text-sm font-medium">
                  <Bn>{p.bn}</Bn>
                </p>
                <p className="text-mkt-slate mt-3 text-sm leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Platform pillars ─────────────────────────────────── */}
      <section className="border-b border-[var(--color-mkt-line)] bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>One platform, end to end</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Everything from the first ticket to the final payout.
            </h2>
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {PILLARS.map((p) => (
              <div key={p.kicker} className="mkt-card p-8">
                <p className="text-mkt-red text-xs font-semibold tracking-[0.18em] uppercase">
                  {p.kicker}
                </p>
                <h3 className="mt-3 text-xl font-semibold">{p.title}</h3>
                <p className="text-mkt-slate mt-3 text-sm leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Use cases ────────────────────────────────────────── */}
      <section className="mkt-glow border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>Use cases · ব্যবহার</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Whatever you’re hosting, the same toolkit scales.
            </h2>
            <p className="text-mkt-slate mt-4 text-base leading-relaxed">
              From a 30-person workshop to a 5,000-seat concert — one workflow, one fee, one payout.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {USE_CASES.map((u) => (
              <div key={u.title} className="mkt-card p-7">
                <h3 className="text-lg font-semibold">{u.title}</h3>
                <p className="text-mkt-red mt-1 text-sm font-medium">
                  <Bn>{u.bn}</Bn>
                </p>
                <p className="text-mkt-slate mt-3 text-sm leading-relaxed">{u.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="border-b border-[var(--color-mkt-line)] bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Live in three steps.
            </h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="mkt-card p-8">
                <span className="text-mkt-red text-4xl font-bold">{s.n}</span>
                <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
                <p className="text-mkt-red mt-1 text-sm font-medium">
                  <Bn>{s.bn}</Bn>
                </p>
                <p className="text-mkt-slate mt-3 text-sm leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── By the numbers ───────────────────────────────────── */}
      <section className="bg-mkt-ink text-white">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px overflow-hidden px-6 py-14 md:grid-cols-4 md:py-16">
          {[
            { stat: '0.25%', label: 'Platform fee', bn: 'প্ল্যাটফর্ম ফি' },
            { stat: 'T+5', label: 'Days to payout', bn: '৫ দিনে পেআউট' },
            { stat: '90s', label: 'Landing to live', bn: 'লাইভ হতে' },
            { stat: '5', label: 'Bank + MFS payout methods', bn: 'পেআউট মাধ্যম' },
          ].map((m) => (
            <div key={m.label} className="px-4 text-center">
              <div className="text-mkt-red text-4xl font-bold tracking-tight md:text-5xl">
                {m.stat}
              </div>
              <div className="mt-2 text-sm font-medium text-white/90">{m.label}</div>
              <div className="mt-0.5 text-xs text-white/55">
                <Bn>{m.bn}</Bn>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Money & trust ────────────────────────────────────── */}
      <section className="mkt-glow border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <Eyebrow>Your money, protected</Eyebrow>
              <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
                A transparent 0.25%. Funds in escrow. Payouts on a schedule.
              </h2>
              <p className="text-mkt-slate mt-4 text-base leading-relaxed">
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
                  <li key={line} className="text-mkt-ink flex items-start gap-3 text-sm">
                    <span
                      aria-hidden="true"
                      className="bg-mkt-red/10 text-mkt-red mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    >
                      ✓
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mkt-card p-6 font-[family-name:var(--font-geist-mono)]">
              <p className="text-mkt-slate text-xs font-semibold tracking-[0.18em] uppercase">
                Settlement preview · per ৳1,000 ticket
              </p>
              <dl className="mt-4 space-y-2.5 text-sm">
                {[
                  ['Ticket face value', '৳1,000.00'],
                  ['Platform fee (0.25%)', '− ৳2.50'],
                  ['EPS gateway (pass-through)', 'buyer pays'],
                ].map(([k, v]) => (
                  <div key={k} className="text-mkt-slate flex items-center justify-between">
                    <dt>{k}</dt>
                    <dd className="text-mkt-ink">{v}</dd>
                  </div>
                ))}
                <div className="border-mkt-line mt-3 flex items-center justify-between border-t pt-3 text-base font-semibold">
                  <dt className="text-mkt-ink">You receive (T+5)</dt>
                  <dd className="text-mkt-red">৳997.50</dd>
                </div>
              </dl>
              <p className="text-mkt-slate mt-4 text-xs">
                Illustrative. The live calculator shows every fee mode at checkout.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats band ───────────────────────────────────────── */}
      <section className="border-b border-[var(--color-mkt-line)] bg-white">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="grid gap-px overflow-hidden rounded-2xl border border-[var(--color-mkt-line)] bg-[var(--color-mkt-line)] sm:grid-cols-2 lg:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="bg-white p-8 text-center">
                <p className="text-mkt-red text-4xl font-bold tracking-tight">{s.value}</p>
                <p className="text-mkt-slate mt-2 text-sm">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonial ──────────────────────────────────────── */}
      <section className="mkt-glow border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-4xl px-6 py-16 md:py-20">
          <div className="mkt-card p-10 text-center md:p-14">
            <p className="text-2xl leading-relaxed font-medium md:text-3xl">
              “We used to run alumni registration on three spreadsheets and a personal bKash. With
              Event Pulse, sales, the guest list, and the gate are one link — and the payout just
              arrives.”
            </p>
            <p className="text-mkt-slate mt-6 text-sm">
              Organising committee · university reunion, ~1,200 attendees
            </p>
          </div>
        </div>
      </section>

      {/* ── Pricing teaser ───────────────────────────────────── */}
      <section className="border-b border-[var(--color-mkt-line)] bg-white">
        <div className="mx-auto max-w-5xl px-6 py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>Pricing · প্রাইসিং</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              One number. No surprises.
            </h2>
            <p className="text-mkt-slate mt-4 text-base leading-relaxed">
              0.25% per paid transaction. Free events are free, forever. EPS gateway fees pass
              through at cost, and you decide who carries them.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link href="/pricing" className={SECONDARY_CTA}>
                See the full breakdown
              </Link>
              <Link
                href="/features"
                className="text-mkt-red inline-flex h-12 items-center px-4 text-sm font-semibold hover:underline"
              >
                Explore all features →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Ask the AI (AEO) ─────────────────────────────────── */}
      <section className="border-b border-[var(--color-mkt-line)] bg-white">
        <div className="mx-auto max-w-3xl px-6 py-12">
          <AskAiCard />
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section className="mkt-glow border-b border-[var(--color-mkt-line)]">
        <div className="mx-auto max-w-3xl px-6 py-16 md:py-20">
          <div className="text-center">
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
              Everything you need to know.
            </h2>
          </div>
          <div className="mt-10 space-y-3">
            {FAQS.map((f) => (
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
      </section>

      {/* ── Final CTA ────────────────────────────────────────── */}
      <section className="mkt-hero">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center md:py-24">
          <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
            Your next event, live in 90 seconds.
          </h2>
          <p className="text-mkt-slate mt-4 text-lg">
            <Bn>আজই শুরু করুন — ফ্রি ইভেন্ট সঙ্গে সঙ্গে লাইভ।</Bn>
          </p>
          <p className="text-mkt-slate mt-3 text-base leading-relaxed">
            Sign up with your email — free events publish instantly, paid events graduate through a
            quick KYC check before tickets go live.
          </p>
          <div className="mt-8 flex justify-center">
            <Link href="/sign-up" className={PRIMARY_CTA}>
              Start free
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
      <SoftwareApplicationJsonLd />
      <FaqJsonLd items={FAQS} />
    </main>
  )
}

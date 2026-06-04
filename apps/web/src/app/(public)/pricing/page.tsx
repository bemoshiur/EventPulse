import type { Metadata } from 'next'
import Link from 'next/link'

import { GlassCard } from '@/components/ui/glass-card'
import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'

export const metadata: Metadata = {
  title: 'Pricing — Event Pulse',
  description:
    'Flat 0.25% platform fee. EPS gateway fees pass through at cost. v1.0 launches with bKash at 2.0%. Run the numbers for your event.',
}

const PLATFORM_FEE_BPS = 25
// Production-confirmed bKash rate (Day-46 BDT-102 smoke: 2.04/102.00 = 2.0%).
// Must stay in lock-step with DEFAULT_EPS_FEE_BPS_ESTIMATE in the API.
const BKASH_FEE_BPS = 200
const BPS_DIVISOR = 10_000n

const FACE_VALUES_PAISA = [50_000n, 100_000n, 500_000n, 1_000_000n, 5_000_000n] as const

type Mode = 'absorb_absorb' | 'absorb_pass' | 'pass_absorb' | 'pass_pass'

type ModeRow = {
  facePaisa: bigint
  buyerTotalPaisa: bigint
  organiserNetPaisa: bigint
}

function feeOnAmount(amountPaisa: bigint, bps: number): bigint {
  return (amountPaisa * BigInt(bps)) / BPS_DIVISOR
}

function compute(facePaisa: bigint, mode: Mode): ModeRow {
  const platformFee = feeOnAmount(facePaisa, PLATFORM_FEE_BPS)
  const [platformHandling, epsHandling] = mode.split('_') as ['absorb' | 'pass', 'absorb' | 'pass']

  const epsCaptureBase = platformHandling === 'pass' ? facePaisa + platformFee : facePaisa
  const epsFee = feeOnAmount(epsCaptureBase, BKASH_FEE_BPS)

  const buyerTotal =
    facePaisa +
    (platformHandling === 'pass' ? platformFee : 0n) +
    (epsHandling === 'pass' ? epsFee : 0n)

  const organiserNet =
    facePaisa -
    (platformHandling === 'absorb' ? platformFee : 0n) -
    (epsHandling === 'absorb' ? epsFee : 0n)

  return { facePaisa, buyerTotalPaisa: buyerTotal, organiserNetPaisa: organiserNet }
}

function formatBdt(paisa: bigint): string {
  const sign = paisa < 0n ? '-' : ''
  const abs = paisa < 0n ? -paisa : paisa
  const taka = abs / 100n
  const paisaPart = abs % 100n
  const takaStr = taka.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}৳ ${takaStr}.${paisaPart.toString().padStart(2, '0')}`
}

const MODES: { mode: Mode; label: string; subtitle: string }[] = [
  {
    mode: 'pass_pass',
    label: 'Both pass-through',
    subtitle: 'Buyer pays the fees on top. You keep the full ticket value.',
  },
  {
    mode: 'absorb_absorb',
    label: 'Both absorb',
    subtitle: 'Cleanest UX — buyer sees one number. You eat both fees.',
  },
  {
    mode: 'absorb_pass',
    label: 'Platform absorb, payment pass-through',
    subtitle: 'You eat the 0.25%. Buyer pays the payment fee.',
  },
  {
    mode: 'pass_absorb',
    label: 'Platform pass-through, payment absorb',
    subtitle: 'You eat the payment fee. Buyer pays the 0.25%.',
  },
]

export default function PricingPage() {
  return (
    <>
      <MarketingNavbar current="pricing" />

      <section className="relative">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center md:py-24">
          <p className="text-xs font-semibold tracking-widest text-[var(--color-mkt-red)] uppercase">
            Pricing
          </p>
          <h1 className="font-display mt-3 text-3xl font-semibold text-[var(--color-mkt-ink)] md:text-5xl">
            A flat <span className="text-[var(--color-mkt-red)]">0.25%</span> on every paid ticket.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-[var(--color-mkt-slate)]">
            No setup fee. No monthly minimum. No per-event charge. Free events pay nothing.
            Payment-gateway fees pass through at cost — we never mark them up.
          </p>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-5xl px-6 pb-12">
          <GlassCard variant="strong" className="p-8 md:p-12">
            <div className="mb-6 flex flex-col items-start justify-between gap-2 md:flex-row md:items-end">
              <div>
                <p className="text-xs font-semibold tracking-widest text-[var(--color-mkt-red)] uppercase">
                  Transparency calculator
                </p>
                <h2 className="font-display mt-2 text-2xl font-semibold text-[var(--color-mkt-ink)]">
                  What your ticket actually pays out.
                </h2>
              </div>
              <p className="text-xs text-[var(--color-mkt-slate)]">
                Platform 0.25% &middot; bKash 2.0% &middot; all four fee modes shown
              </p>
            </div>

            <div className="space-y-6">
              {MODES.map(({ mode, label, subtitle }) => {
                const rows = FACE_VALUES_PAISA.map((face) => compute(face, mode))
                return (
                  <div key={mode}>
                    <h3 className="text-sm font-semibold text-[var(--color-mkt-ink)]">{label}</h3>
                    <p className="text-xs text-[var(--color-mkt-slate)]">{subtitle}</p>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[560px] border-separate border-spacing-y-2 text-sm">
                        <thead className="text-xs tracking-wider text-[var(--color-mkt-slate)] uppercase">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">Ticket face</th>
                            <th className="px-3 py-2 text-right font-semibold">Buyer pays</th>
                            <th className="px-3 py-2 text-right font-semibold">You receive</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <tr
                              key={row.facePaisa.toString()}
                              className="rounded-lg bg-[var(--color-mkt-paper)]/60"
                            >
                              <td className="rounded-l-lg px-3 py-3 font-mono text-sm text-[var(--color-mkt-ink)]">
                                {formatBdt(row.facePaisa)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-sm text-[var(--color-mkt-ink)]">
                                {formatBdt(row.buyerTotalPaisa)}
                              </td>
                              <td className="rounded-r-lg px-3 py-3 text-right font-mono text-sm font-semibold text-[var(--emerald-600)]">
                                {formatBdt(row.organiserNetPaisa)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          </GlassCard>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 pb-16">
          <GlassCard className="p-7">
            <h3 className="text-sm font-semibold text-[var(--color-mkt-ink)]">
              About the rate shown above
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-mkt-slate)]">
              The calculator above uses the v1.0 launch bKash rate (2.0% on capture). Card, Nagad,
              Rocket, and Upay rates publish when those methods join post-launch.
            </p>
            <p
              lang="bn"
              className="mt-3 text-sm leading-relaxed font-[var(--ep-bn-font)] text-[var(--color-mkt-slate)]"
            >
              উপরের ক্যালকুলেটরটি v1.0 লঞ্চের bKash রেট (২.০%) ব্যবহার করছে। কার্ড / নগদ / রকেট /
              উপয় রেট লঞ্চ-পরবর্তী যখন সেই পদ্ধতিগুলো যোগ হবে তখন প্রকাশিত হবে।
            </p>
          </GlassCard>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-4xl px-6 pb-16 md:pb-24">
          <header className="mb-8 text-center">
            <p className="text-xs font-semibold tracking-widest text-[var(--color-mkt-red)] uppercase">
              Questions
            </p>
            <h2 className="font-display mt-2 text-2xl font-semibold text-[var(--color-mkt-ink)] md:text-3xl">
              Pricing FAQ
            </h2>
          </header>

          <div className="grid gap-4 md:grid-cols-2">
            <GlassCard className="p-6">
              <h3 className="text-sm font-semibold text-[var(--color-mkt-ink)]">
                What does &ldquo;pass-through&rdquo; mean?
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-mkt-slate)]">
                The fee is added on top of the ticket price at checkout. The buyer sees it as a
                separate line item. You receive the full face value at settlement.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h3 className="text-sm font-semibold text-[var(--color-mkt-ink)]">
                What does &ldquo;absorb&rdquo; mean?
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-mkt-slate)]">
                The fee is deducted from the ticket price. The buyer sees one clean number. You
                receive the face value minus the absorbed fee at settlement.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h3 className="text-sm font-semibold text-[var(--color-mkt-ink)]">
                Do free events cost anything?
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-mkt-slate)]">
                No. Free events pay no platform fee and no gateway fee, because no money moves. You
                can run unlimited free events with no KYC.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h3 className="text-sm font-semibold text-[var(--color-mkt-ink)]">
                When do I get paid?
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-mkt-slate)]">
                T+5 business days. Net proceeds settle to your bank account at launch. bKash, Nagad,
                Rocket, and Upay payout adapters arrive in Phase 2.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h3 className="text-sm font-semibold text-[var(--color-mkt-ink)]">
                Are there volume discounts?
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-mkt-slate)]">
                For enterprise customers running consistent high-volume events, contact support.
                Default for everyone is the flat 0.25%.
              </p>
            </GlassCard>

            <GlassCard className="p-6">
              <h3 className="text-sm font-semibold text-[var(--color-mkt-ink)]">
                What about VAT and withholding?
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-mkt-slate)]">
                VAT (15%) applies to our service fee per NBR. Withholding (AIT) on payouts is
                handled per your tax status and documented on every disbursement.
              </p>
            </GlassCard>
          </div>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 pb-24 text-center">
          <h2 className="font-display text-2xl font-semibold text-[var(--color-mkt-ink)] md:text-3xl">
            Sign up and ship your first event.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-mkt-slate)]">
            Free events publish in under 90 seconds. Paid events graduate through KYC before tickets
            go on sale.
          </p>
          <div className="mt-6">
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

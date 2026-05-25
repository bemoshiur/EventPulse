'use client'

/**
 * PayoutsView — tenant portal "what's owed" view.
 * Sprint 4 Day 33 Phase 3.
 *
 * READ-ONLY view of the snapshotted netToOrganiserPaisa plus the
 * tenant's CURRENT fee config. This is NOT a disbursement action
 * (no money moves; Day 7-8 is the disbursement work, and real
 * disbursement is gated on the truth gate).
 *
 * The display deliberately frames the headline number as "pending
 * payout / amount owed" so a tenant looking at it understands
 * "this is what you have coming to you" without confusing it with
 * "this has been paid out."
 */

import { formatBdt, formatNumber } from '@/hooks/use-tenant-sales'
import { formatBps, useTenantPayouts } from '@/hooks/use-tenant-payouts'

function SummaryRow({
  label,
  value,
  hint,
  testId,
}: {
  label: string
  value: string
  hint?: string
  testId?: string
}) {
  return (
    <div
      className="flex items-baseline justify-between border-b border-[var(--ep-line)] py-3 last:border-b-0"
      data-testid={testId}
    >
      <div>
        <div className="text-sm font-medium text-[var(--ep-ink)]">{label}</div>
        {hint ? <div className="mt-0.5 text-xs text-[var(--ep-graphite)]">{hint}</div> : null}
      </div>
      <div className="text-base font-semibold text-[var(--ep-ink)]">{value}</div>
    </div>
  )
}

export function PayoutsView() {
  const { data, error, isLoading } = useTenantPayouts()

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-2xl border border-[var(--ep-line)] bg-white/40 p-6 text-sm text-[var(--ep-graphite)]"
      >
        Loading payouts view…
      </div>
    )
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--ep-rose)]/40 bg-[var(--ep-rose)]/5 p-6 text-sm text-[var(--ep-rose)]"
      >
        Failed to load payouts: {(error as Error).message}
      </div>
    )
  }

  if (!data) return null
  const p = data.data
  const hasAnyPayable = BigInt(p.pendingPayoutPaisa) > 0n || p.paidOrderCount > 0
  const hasRefundLeak = p.refundLeakOrderCount > 0

  return (
    <section aria-label="Payouts" className="space-y-6">
      {/* Headline pending-payout card */}
      <div
        className="rounded-3xl border border-[var(--ep-mint)]/40 bg-gradient-to-br from-[var(--ep-mint)]/15 to-[var(--ep-cerulean)]/10 p-8"
        data-testid="payable-card"
      >
        <div className="text-xs font-medium tracking-wide text-[var(--ep-graphite)] uppercase">
          Pending payout
        </div>
        <div className="mt-2 text-5xl font-semibold text-[var(--ep-ink)]">
          {formatBdt(p.pendingPayoutPaisa)}
        </div>
        <div className="mt-3 text-sm text-[var(--ep-graphite)]">
          Net you&apos;re owed across {formatNumber(p.paidOrderCount)} paid order
          {p.paidOrderCount === 1 ? '' : 's'}. Automated disbursement (T+5) ships in a future
          sprint; for now this is what your settlement total will be when payouts go live.
        </div>
      </div>

      {!hasAnyPayable ? (
        <div
          className="rounded-2xl border border-[var(--ep-cerulean)]/40 bg-[var(--ep-cerulean)]/5 p-6 text-sm text-[var(--ep-cerulean)]"
          data-testid="empty-state"
        >
          No paid orders yet. Once buyers pay, your net (face value minus the platform fee and the
          payment-gateway fee) shows up here.
        </div>
      ) : null}

      {/* Snapshot breakdown */}
      <div className="rounded-2xl border border-[var(--ep-line)] bg-white/40 p-6">
        <h2 className="mb-4 text-xl font-semibold text-[var(--ep-ink)]">Where the money goes</h2>
        <div className="space-y-0" data-testid="snapshot-breakdown">
          <SummaryRow
            label="Gross revenue"
            value={formatBdt(p.grossRevenuePaisa)}
            hint="Sum of paid order totals (snapshotted)"
            testId="row-gross"
          />
          <SummaryRow
            label="Platform fee"
            value={formatBdt(p.platformFeePaisa)}
            hint="What Event Pulse retained on these orders (snapshotted, not current)"
            testId="row-platform-fee"
          />
          <SummaryRow
            label="Payment gateway fee (EPS)"
            value={formatBdt(p.epsFeePaisa)}
            hint="Pass-through to the payment processor"
            testId="row-eps-fee"
          />
          {BigInt(p.withholdingTaxPaisa) > 0n ? (
            <SummaryRow
              label="Withholding tax (AIT)"
              value={formatBdt(p.withholdingTaxPaisa)}
              hint="Deducted at source where applicable"
              testId="row-wht"
            />
          ) : null}
          <SummaryRow
            label="Net to you"
            value={formatBdt(p.pendingPayoutPaisa)}
            hint="Gross − platform fee − EPS fee − withholding"
            testId="row-net"
          />
        </div>
      </div>

      {/* Refund-leak card */}
      {hasRefundLeak ? (
        <div
          className="rounded-2xl border border-[var(--ep-amber)]/40 bg-[var(--ep-amber)]/5 p-6"
          data-testid="refund-leak-card"
        >
          <h2 className="text-base font-semibold text-[var(--ep-amber)]">Refund + reversal leak</h2>
          <p className="mt-1 text-sm text-[var(--ep-graphite)]">
            {formatNumber(p.refundLeakOrderCount)} order
            {p.refundLeakOrderCount === 1 ? '' : 's'} totalling{' '}
            <strong>{formatBdt(p.refundLeakPaisa)}</strong> are in refund or chargeback states.
            These are excluded from your pending payout.
          </p>
        </div>
      ) : null}

      {/* Current fee terms */}
      <div className="rounded-2xl border border-[var(--ep-line)] bg-white/40 p-6">
        <h2 className="mb-4 text-xl font-semibold text-[var(--ep-ink)]">Your current fee terms</h2>
        <div className="space-y-0" data-testid="current-fees">
          <SummaryRow
            label="Platform fee rate"
            value={formatBps(p.currentFees.platformFeeBps)}
            hint={
              p.currentFees.hasOverride
                ? 'Custom rate set by Event Pulse'
                : 'Standard platform rate'
            }
            testId="row-platform-bps"
          />
          <SummaryRow
            label="Default fee mode"
            value={p.currentFees.defaultFeeMode === 'pass_through' ? 'Pass to buyer' : 'You absorb'}
            hint="What new events default to; can override per event"
            testId="row-fee-mode"
          />
          {p.currentFees.customArrangementNote ? (
            <SummaryRow
              label="Arrangement notes"
              value={p.currentFees.customArrangementNote}
              testId="row-note"
            />
          ) : null}
        </div>
        <p className="mt-4 text-xs text-[var(--ep-graphite)]">
          The fees above are your CURRENT rates. Past orders show their snapshotted fees (above) —
          they reflect what was charged at the time, not what would be charged today.
        </p>
      </div>
    </section>
  )
}

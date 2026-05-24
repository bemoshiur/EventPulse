'use client'

/**
 * /admin/tenants/[id]/fees — Super-admin tenant fee-config surface.
 *
 * Sprint 3 Day 23 Workstream 2 per CLAUDE.md §10.4 + §14.4. Lets a
 * super admin view the tenant's current effective platform fee +
 * default fee-handling mode, audit the change history, and (with
 * typed confirmation) set or clear a per-tenant override.
 *
 * Anomaly UX: deltas exceeding ±10 bps surface as a warning banner in
 * the override form per §14.4. Server still records is_anomalous on
 * the audit row regardless; the UI nudge is just to prompt the
 * reviewer to add a thorough reason.
 *
 * Money math: NONE. This page reads/writes basis points + mode only.
 * The fee calculator (apps/api/src/domain/payments/fee-calculator.ts)
 * is the sole consumer of the bps stored here.
 */

import { use, useState } from 'react'

import {
  useClearOverride,
  useEffectiveFees,
  useFeeHistory,
  useSetOverride,
} from '@/hooks/use-admin-fee-config'

const ANOMALOUS_FEE_DELTA_BPS = 10
const PLATFORM_DEFAULT_FEE_BPS = 25

function formatBps(bps: number): string {
  return `${bps} bps (${(bps / 100).toFixed(2)}%)`
}

function ModePill({ mode }: { mode: 'absorb' | 'pass_through' }) {
  const tone =
    mode === 'absorb'
      ? 'bg-[var(--ep-amber)]/15 text-[var(--ep-amber)]'
      : 'bg-[var(--ep-cerulean)]/15 text-[var(--ep-cerulean)]'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {mode === 'absorb' ? 'Absorb' : 'Pass-through'}
    </span>
  )
}

export default function AdminTenantFeesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = use(params)
  const effective = useEffectiveFees(tenantId)
  const history = useFeeHistory(tenantId, 50)
  const setOverride = useSetOverride(tenantId)
  const clearOverride = useClearOverride(tenantId)

  // Override form state
  const currentBps = effective.data?.platformFeeBps ?? PLATFORM_DEFAULT_FEE_BPS
  const currentMode = effective.data?.defaultFeeMode ?? 'pass_through'
  const [newBps, setNewBps] = useState<number>(currentBps)
  const [newMode, setNewMode] = useState<'absorb' | 'pass_through'>(currentMode)
  const [reason, setReason] = useState('')
  const [customNote, setCustomNote] = useState('')

  const deltaBps = Math.abs(newBps - currentBps)
  const isAnomalous = deltaBps > ANOMALOUS_FEE_DELTA_BPS

  const onOverrideSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setOverride.mutate({
      newFeeBps: newBps,
      newMode,
      reason,
      customArrangementNote: customNote || null,
    })
  }

  const onClearSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const confirmed = window.confirm(
      `Reset tenant to platform default (${PLATFORM_DEFAULT_FEE_BPS} bps, pass_through)?`,
    )
    if (!confirmed) return
    const r = window.prompt('Reason for clearing override (required, audit trail):')
    if (!r || !r.trim()) return
    clearOverride.mutate({ reason: r.trim() })
  }

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-3xl font-semibold text-[var(--ep-ink)]">Tenant fee configuration</h2>
        <p className="mt-1 text-sm text-[var(--ep-graphite)]">
          Platform fee override + default fee-handling mode. Changes are non-retroactive (§14.4);
          orders already paid keep their snapshotted fee.
        </p>
      </header>

      {/* Effective fees */}
      <section className="rounded-2xl border border-[var(--ep-line)] bg-white/60 p-6 shadow-sm">
        <h3 className="text-xl font-semibold text-[var(--ep-ink)]">Currently effective</h3>
        {effective.isLoading ? (
          <p className="mt-3 text-sm text-[var(--ep-graphite)]">Loading…</p>
        ) : effective.error ? (
          <p className="mt-3 text-sm text-[var(--ep-rose)]">
            Failed to load effective fees: {(effective.error as Error).message}
          </p>
        ) : (
          <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-xs font-medium tracking-wide text-[var(--ep-graphite)] uppercase">
                Platform fee
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-[var(--ep-ink)]">
                {formatBps(effective.data!.platformFeeBps)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-[var(--ep-graphite)] uppercase">
                Default fee mode
              </dt>
              <dd className="mt-1">
                <ModePill mode={effective.data!.defaultFeeMode} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-[var(--ep-graphite)] uppercase">
                Source
              </dt>
              <dd className="mt-1 text-sm text-[var(--ep-graphite)]">
                {effective.data!.hasOverride
                  ? `Tenant override · effective ${effective.data!.effectiveFrom?.slice(0, 19)}Z`
                  : 'Platform default (no override row)'}
              </dd>
            </div>
            {effective.data!.customArrangementNote ? (
              <div className="md:col-span-2">
                <dt className="text-xs font-medium tracking-wide text-[var(--ep-graphite)] uppercase">
                  Custom arrangement note
                </dt>
                <dd className="mt-1 text-sm text-[var(--ep-graphite)] italic">
                  {effective.data!.customArrangementNote}
                </dd>
              </div>
            ) : null}
          </dl>
        )}
      </section>

      {/* Override form */}
      <section className="rounded-2xl border border-[var(--ep-line)] bg-white/60 p-6 shadow-sm">
        <h3 className="text-xl font-semibold text-[var(--ep-ink)]">Set / update override</h3>
        <p className="mt-1 text-sm text-[var(--ep-graphite)]">
          Reason is required — it's logged to fee_override_log + audit_logs.
        </p>
        <form onSubmit={onOverrideSubmit} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-[var(--ep-ink)]">
              New platform fee (basis points)
            </label>
            <input
              type="number"
              min={0}
              max={10000}
              value={newBps}
              onChange={(e) => setNewBps(Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
              required
            />
            <p className="mt-1 text-xs text-[var(--ep-graphite)]">
              {formatBps(newBps)} · 25 = 0.25% (platform default)
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ep-ink)]">
              Default fee mode
            </label>
            <select
              value={newMode}
              onChange={(e) => setNewMode(e.target.value as 'absorb' | 'pass_through')}
              className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white px-3 py-2 text-sm"
            >
              <option value="pass_through">pass_through (buyer pays fee)</option>
              <option value="absorb">absorb (organiser eats fee)</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-[var(--ep-ink)]">
              Reason (required)
            </label>
            <input
              type="text"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Enterprise contract EP-2026-001"
              className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-[var(--ep-ink)]">
              Custom arrangement note (optional, visible to tenant)
            </label>
            <textarea
              rows={2}
              maxLength={1000}
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              placeholder="e.g. BDT 100,000/month minimum; contact legal@ for terms"
              className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
            />
          </div>

          {isAnomalous ? (
            <div className="md:col-span-2">
              <div className="rounded-md border border-[var(--ep-amber)] bg-[var(--ep-amber)]/10 p-3 text-sm text-[var(--ep-amber)]">
                <strong>Anomaly:</strong> change of {deltaBps} bps exceeds the ±
                {ANOMALOUS_FEE_DELTA_BPS} bps 4-eyes threshold (§14.4). Server will flag this on the
                audit row. Make sure your reason captures the business justification.
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-3 md:col-span-2">
            {effective.data?.hasOverride ? (
              <button
                type="button"
                onClick={onClearSubmit}
                disabled={clearOverride.isPending}
                className="inline-flex h-11 items-center rounded-md border border-[var(--ep-line)] bg-white px-5 text-sm font-medium text-[var(--ep-graphite)] transition hover:bg-[var(--ep-mist)] disabled:opacity-60"
              >
                {clearOverride.isPending ? 'Clearing…' : 'Reset to platform default'}
              </button>
            ) : null}
            <button
              type="submit"
              disabled={setOverride.isPending || !reason.trim()}
              className="inline-flex h-11 items-center rounded-md bg-[var(--ep-violet)] px-5 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60"
            >
              {setOverride.isPending ? 'Saving…' : 'Save override'}
            </button>
          </div>

          {setOverride.error ? (
            <div className="text-sm text-[var(--ep-rose)] md:col-span-2">
              {(setOverride.error as Error).message}
            </div>
          ) : null}
          {clearOverride.error ? (
            <div className="text-sm text-[var(--ep-rose)] md:col-span-2">
              {(clearOverride.error as Error).message}
            </div>
          ) : null}
        </form>
      </section>

      {/* History */}
      <section className="rounded-2xl border border-[var(--ep-line)] bg-white/60 p-6 shadow-sm">
        <h3 className="text-xl font-semibold text-[var(--ep-ink)]">Change history</h3>
        {history.isLoading ? (
          <p className="mt-3 text-sm text-[var(--ep-graphite)]">Loading…</p>
        ) : history.error ? (
          <p className="mt-3 text-sm text-[var(--ep-rose)]">
            Failed to load history: {(history.error as Error).message}
          </p>
        ) : history.data?.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ep-graphite)]">
            No override history. Tenant has been using the platform default since onboarding.
          </p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="text-xs font-medium tracking-wide text-[var(--ep-graphite)] uppercase">
              <tr>
                <th className="pb-2">When</th>
                <th className="pb-2">From → To</th>
                <th className="pb-2">Mode</th>
                <th className="pb-2">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ep-line)]">
              {history.data!.map((row) => (
                <tr key={row.id}>
                  <td className="py-2 text-[var(--ep-graphite)]">
                    {row.createdAt.slice(0, 19).replace('T', ' ')}Z
                  </td>
                  <td className="py-2 font-mono">
                    {row.previousFeeBps} → {row.newFeeBps}{' '}
                    <span className="text-xs text-[var(--ep-graphite)]">bps</span>
                  </td>
                  <td className="py-2">
                    <ModePill mode={row.previousMode} /> → <ModePill mode={row.newMode} />
                  </td>
                  <td className="py-2 text-[var(--ep-graphite)]">{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

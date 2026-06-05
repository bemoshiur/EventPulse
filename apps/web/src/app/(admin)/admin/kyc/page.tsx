'use client'

/**
 * /admin/kyc — KYC review queue list view. Sprint 2 Day 18 Item 13 PR 4.
 *
 * Default filter: status='submitted'. Reviewer can switch to 'under_review'
 * (their own claimed work) or 'approved'/'rejected' for historical lookup.
 *
 * No PII surfaced here per Decision G + the platform-wide manual-
 * verification policy — list response is tenant name + tier + status +
 * checklist progress count only. Detail view is where PII appears, and
 * that page writes the audit row per Decision G.
 *
 * Cache: default TanStack Query settings (staleTime 30s) — list data
 * is lower-sensitivity. Only the detail-view hook overrides cache
 * lifetimes per Decision H.
 */

import { useState } from 'react'
import Link from 'next/link'

import { useAdminKycList } from '@/hooks/use-admin-kyc'

const STATUS_OPTIONS = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
] as const

type StatusValue = (typeof STATUS_OPTIONS)[number]['value']

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'approved'
      ? 'bg-[#059669]/15 text-[#059669]'
      : status === 'rejected'
        ? 'bg-[var(--color-mkt-red)]/15 text-[var(--color-mkt-red)]'
        : status === 'under_review'
          ? 'bg-[var(--color-mkt-red)]/15 text-[var(--color-mkt-red)]'
          : 'bg-[var(--color-mkt-red)]/15 text-[var(--color-mkt-red)]'
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium tracking-wide uppercase ${tone}`}
    >
      {status}
    </span>
  )
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} d ago`
}

export default function AdminKycQueuePage() {
  const [status, setStatus] = useState<StatusValue>('submitted')
  const { data, error, isLoading } = useAdminKycList({ status })

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-semibold text-[var(--color-mkt-ink)]">KYC review queue</h2>
          <p className="mt-1 text-sm text-[var(--color-mkt-slate)]">
            Manual verification only for MVP. Open a submission to review documents and toggle
            checklist items.
          </p>
        </div>
        <div>
          <label
            htmlFor="status-filter"
            className="mb-1 block text-xs font-medium tracking-wide text-[var(--color-mkt-slate)] uppercase"
          >
            Status
          </label>
          <select
            id="status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusValue)}
            className="rounded-md border border-[var(--color-mkt-line)] bg-white px-3 py-2 text-sm text-[var(--color-mkt-ink)]"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border border-[var(--color-mkt-line)] bg-white p-6 text-sm text-[var(--color-mkt-slate)]"
        >
          Loading queue…
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--color-mkt-red)]/40 bg-[var(--color-mkt-red)]/5 p-6 text-sm text-[var(--color-mkt-red)]"
        >
          Failed to load queue: {(error as Error).message}
        </div>
      ) : !data || data.data.length === 0 ? (
        <div className="rounded-2xl border border-[var(--color-mkt-line)] bg-white p-6 text-sm text-[var(--color-mkt-slate)]">
          No submissions in <strong>{status}</strong> status.
        </div>
      ) : (
        <table className="w-full table-auto border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-mkt-line)] text-left text-xs tracking-wide text-[var(--color-mkt-slate)] uppercase">
              <th className="py-3 pr-4">Tenant</th>
              <th className="py-3 pr-4">Type</th>
              <th className="py-3 pr-4">Tier</th>
              <th className="py-3 pr-4">Status</th>
              <th className="py-3 pr-4">Submitted</th>
              <th className="py-3 pr-4">Checklist</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((row) => (
              <tr
                key={row.id}
                className="border-b border-[var(--color-mkt-line)] transition-colors hover:bg-[var(--color-mkt-soft)]"
              >
                <td className="py-3 pr-4">
                  <Link
                    href={`/admin/kyc/${row.id}`}
                    className="font-medium text-[var(--color-mkt-red)] hover:underline"
                  >
                    {row.tenantName}
                  </Link>
                  <div className="text-xs text-[var(--color-mkt-slate)]">{row.tenantSlug}</div>
                </td>
                <td className="py-3 pr-4 text-[var(--color-mkt-ink)]">{row.submissionType}</td>
                <td className="py-3 pr-4 text-[var(--color-mkt-ink)]">{row.tierRequested}</td>
                <td className="py-3 pr-4">
                  <StatusBadge status={row.status} />
                </td>
                <td className="py-3 pr-4 text-[var(--color-mkt-slate)]">
                  {relativeTime(row.submittedAt)}
                </td>
                <td className="py-3 pr-4 text-[var(--color-mkt-slate)]">
                  {row.checkedKeyCount} verified
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

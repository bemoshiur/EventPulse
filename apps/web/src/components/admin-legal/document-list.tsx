'use client'

/**
 * Admin Legal & Trust document list — Sprint 2 Day 19 Item 15.
 *
 * Renders all 18 documents grouped by category. Each row is a Link to
 * the detail page. Surfaces the current version + DRAFT badge.
 */

import Link from 'next/link'

import { useAdminLegalList } from '@/hooks/use-admin-legal'

export function LegalTrustDocumentList() {
  const { data, isLoading, error } = useAdminLegalList()

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-[var(--ep-line)] bg-white/60 p-6 text-sm text-[var(--ep-graphite)]">
        Loading documents…
      </div>
    )
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--ep-rose)]/40 bg-[var(--ep-rose)]/5 p-5 text-sm text-[var(--ep-ink)]"
      >
        Failed to load: {error.message}
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--ep-line)] bg-white/60 p-6 text-sm text-[var(--ep-graphite)]">
        No documents yet. Run <code>pnpm --filter @eventpulse/api db:seed:legal-documents</code> to
        populate the 18 placeholders.
      </div>
    )
  }

  const contracts = data.filter((d) => d.category === 'legal_contract')
  const artefacts = data.filter((d) => d.category === 'trust_artefact')

  return (
    <div className="space-y-10">
      <Group title="Legal contracts" rows={contracts} />
      <Group title="Trust artefacts" rows={artefacts} />
    </div>
  )
}

function Group({
  title,
  rows,
}: {
  title: string
  rows: Array<{
    slug: string
    title: string
    canonicalUrlPath: string
    currentVersion: { version: string; isDraft: boolean }
    hasCurrentVersion: boolean
  }>
}) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold tracking-widest text-[var(--ep-graphite)] uppercase">
        {title} · {rows.length}
      </h2>
      <ul className="divide-y divide-[var(--ep-line)] overflow-hidden rounded-2xl border border-[var(--ep-line)] bg-white/60">
        {rows.map((row) => (
          <li key={row.slug}>
            <Link
              href={`/admin/legal-trust/${row.slug}`}
              className="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-[var(--ep-mist)]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <p className="truncate text-sm font-medium text-[var(--ep-ink)]">{row.title}</p>
                  {row.currentVersion.isDraft ? (
                    <span className="shrink-0 rounded-full bg-[var(--ep-amber)]/15 px-2 py-0.5 text-xs font-medium text-[var(--ep-amber)]">
                      Draft
                    </span>
                  ) : null}
                  {!row.hasCurrentVersion ? (
                    <span className="shrink-0 rounded-full bg-[var(--ep-rose)]/15 px-2 py-0.5 text-xs font-medium text-[var(--ep-rose)]">
                      Unpublished
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-xs text-[var(--ep-graphite)]">
                  {row.canonicalUrlPath} · version {row.currentVersion.version}
                </p>
              </div>
              <span aria-hidden className="text-[var(--ep-graphite)]">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

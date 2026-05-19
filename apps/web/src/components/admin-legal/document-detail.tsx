'use client'

/**
 * Admin Legal & Trust editor — single document detail view —
 * Sprint 2 Day 19 Item 15.
 *
 * Three sections:
 *   1. Header — title + canonical URL + current version
 *   2. Publish-new-version form (PublishForm component)
 *   3. Version history list
 *
 * The current version's body_html is NOT shown inline (it's already
 * live on the public page — the admin opens the public URL in a new
 * tab to see it). The editor focuses on authoring the next version.
 */

import Link from 'next/link'
import { useState } from 'react'

import { useAdminLegalDetail } from '@/hooks/use-admin-legal'
import { PublishVersionForm } from './publish-form'

export function LegalTrustDocumentDetail({ slug }: { slug: string }) {
  const { data, isLoading, error } = useAdminLegalDetail(slug)
  const [showPublish, setShowPublish] = useState(false)

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-[var(--ep-line)] bg-white/60 p-6 text-sm text-[var(--ep-graphite)]">
        Loading…
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

  if (!data) return null
  const { document, versions } = data

  return (
    <div className="space-y-8">
      <header>
        <nav className="text-sm text-[var(--ep-graphite)]">
          <Link href="/admin/legal-trust" className="hover:text-[var(--ep-violet)]">
            ← Legal &amp; Trust
          </Link>
        </nav>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-[var(--ep-ink)]">{document.title}</h1>
            <p className="mt-1 text-sm text-[var(--ep-graphite)]">
              <a
                href={document.canonicalUrlPath}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--ep-violet)] hover:underline"
              >
                {document.canonicalUrlPath} ↗
              </a>{' '}
              · {document.category === 'legal_contract' ? 'Contract' : 'Artefact'}
              {document.requiresSignature ? ' · requires consent' : ''}
            </p>
            <p className="mt-1 text-sm text-[var(--ep-graphite)]">
              Current: version {document.currentVersion.version}
              {document.currentVersion.isDraft ? ' · draft' : ''}
              {document.currentVersion.materialChange ? ' · material change' : ''}
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setShowPublish((s) => !s)}
              className="rounded-lg bg-[var(--ep-violet)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--ep-indigo)]"
            >
              {showPublish ? 'Cancel' : 'Publish new version'}
            </button>
          </div>
        </div>
      </header>

      {showPublish ? (
        <PublishVersionForm
          slug={slug}
          currentVersion={document.currentVersion.version}
          onPublished={() => setShowPublish(false)}
        />
      ) : null}

      <section>
        <h2 className="mb-3 text-xs font-semibold tracking-widest text-[var(--ep-graphite)] uppercase">
          Version history · {versions.length}
        </h2>
        <ul className="divide-y divide-[var(--ep-line)] overflow-hidden rounded-2xl border border-[var(--ep-line)] bg-white/60">
          {versions.map((v) => (
            <li key={v.id} className="px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium text-[var(--ep-ink)]">{v.version}</p>
                    {v.isCurrent ? (
                      <span className="rounded-full bg-[var(--ep-mint)]/15 px-2 py-0.5 text-xs font-medium text-[var(--ep-mint)]">
                        Current
                      </span>
                    ) : null}
                    {v.materialChange ? (
                      <span className="rounded-full bg-[var(--ep-amber)]/15 px-2 py-0.5 text-xs font-medium text-[var(--ep-amber)]">
                        Material change
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-[var(--ep-graphite)]">
                    Effective {new Date(v.effectiveAt).toLocaleString('en-GB')}
                  </p>
                  {v.summaryOfChanges ? (
                    <p className="mt-1 text-xs text-[var(--ep-graphite)] italic">
                      “{v.summaryOfChanges}”
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

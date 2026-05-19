/**
 * Super admin Legal & Trust editor — document list — Sprint 2 Day 19 Item 15.
 *
 * Lists all 18 legal documents with their current version + DRAFT badge.
 * Click-through to /admin/legal-trust/[slug] for detail + publish.
 */

import { LegalTrustDocumentList } from '@/components/admin-legal/document-list'

export default function LegalTrustListPage() {
  return (
    <section className="space-y-8">
      <header>
        <p className="text-xs font-semibold tracking-widest text-[var(--ep-violet)] uppercase">
          Super admin
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-[var(--ep-ink)]">Legal &amp; Trust</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--ep-graphite)]">
          Manage the 18 Trust Center documents. Editing a document creates a new version; the public
          page is invalidated on publish.
        </p>
      </header>

      <LegalTrustDocumentList />
    </section>
  )
}

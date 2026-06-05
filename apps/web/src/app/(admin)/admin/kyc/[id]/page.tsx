'use client'

/**
 * /admin/kyc/[id] — submission detail view. Sprint 2 Day 18 Item 13 PR 4.
 *
 * The highest-PII surface in the project. Per Decision G, every page
 * load writes an audit_log row (server side, inside the detail-view
 * route). Per Decision H, the detail-fetch hook overrides cache
 * lifetimes so PII evaporates on navigation away.
 *
 * Layout: two-column desktop layout. Left = submission fields +
 * reviewer checklist + reviewer notes. Right = document viewer +
 * decision actions.
 */

import { useParams } from 'next/navigation'
import Link from 'next/link'

import { useAdminKycDetail } from '@/hooks/use-admin-kyc'
import { SubmissionDetail } from '@/components/admin-kyc/submission-detail'
import { DocumentViewer } from '@/components/admin-kyc/document-viewer'
import { ReviewerNotes } from '@/components/admin-kyc/reviewer-notes'
import { DecisionActions } from '@/components/admin-kyc/decision-actions'

export default function AdminKycDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? null
  const { data, error, isLoading } = useAdminKycDetail(id)

  if (isLoading || !data) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-2xl border border-[var(--color-mkt-line)] bg-white p-6 text-sm text-[var(--color-mkt-slate)]"
      >
        {error
          ? `Failed to load submission: ${(error as Error).message}`
          : 'Loading submission detail…'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-[var(--color-mkt-slate)]">
        <Link href="/admin/kyc" className="hover:underline">
          ← Back to queue
        </Link>
      </nav>

      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-[var(--color-mkt-ink)]">
            Submission <code className="text-sm">{data.id.slice(0, 8)}</code>
          </h2>
          <p className="mt-1 text-sm text-[var(--color-mkt-slate)]">
            {data.submissionType} · {data.tierRequested} ·{' '}
            <span className="font-medium uppercase">{data.status}</span>
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="left-pane" className="space-y-6">
          <h3 id="left-pane" className="sr-only">
            Submission data + reviewer state
          </h3>
          <SubmissionDetail submission={data} />
          <ReviewerNotes submissionId={data.id} initialNotes={data.reviewerNotes ?? ''} />
        </section>

        <section aria-labelledby="right-pane" className="space-y-6">
          <h3 id="right-pane" className="sr-only">
            Documents + decision actions
          </h3>
          <DocumentViewer
            documents={data.documents}
            signedDocuments={data.signedDocuments}
            submissionId={data.id}
            submissionType={data.submissionType}
            checklist={data.reviewerChecklist}
          />
          <DecisionActions
            submissionId={data.id}
            submissionType={data.submissionType}
            status={data.status}
            checklist={data.reviewerChecklist}
          />
        </section>
      </div>
    </div>
  )
}

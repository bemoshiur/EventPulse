'use client'

/**
 * DecisionActions — Sprint 2 Day 18 Item 13 PR 4.
 *
 * Approve + Reject buttons at the bottom of the detail view (Decision I).
 *
 * Approve:
 *   - Disabled until all required-for-tier checklist keys are checked
 *     (client-side enforcement; server re-validates).
 *   - Modal requires the reviewer to type "APPROVE" to enable submit
 *     — friction by design, per user brief §2.3.
 *
 * Reject:
 *   - Modal requires a typed reason (10-1000 chars) + optional
 *     category dropdown.
 *
 * On submit: PATCH to /decide endpoint. On 409 CONFLICT_OF_INTEREST,
 * surface a clear error (the server-side enforcement covers cases the
 * frontend can't pre-detect; the user brief mentions a tooltip-disable
 * version as a Sprint 2 closeout polish item).
 */

import { useEffect, useRef, useState } from 'react'

import {
  REJECTION_CATEGORIES,
  requiredChecklistKeysFor,
  type RejectionCategory,
} from '@eventpulse/shared-types'

import { useDecideSubmission, type KycSubmissionDetailRow } from '@/hooks/use-admin-kyc'

interface Props {
  submissionId: string
  submissionType: 'individual' | 'organisation'
  status: KycSubmissionDetailRow['status']
  checklist: KycSubmissionDetailRow['reviewerChecklist']
}

function ApproveModal({
  onClose,
  onSubmit,
  isPending,
  errorMessage,
}: {
  onClose: () => void
  onSubmit: () => void
  isPending: boolean
  errorMessage: string | null
}) {
  const [typed, setTyped] = useState('')
  const canSubmit = typed === 'APPROVE' && !isPending

  // ESC closes the dialog per WCAG 2.1 SC 2.1.2 + user brief §2.3
  // ("admin modals are dismissable"). Without this a keyboard-only
  // reviewer would be trapped in the modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="approve-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 id="approve-modal-title" className="text-lg font-semibold text-[var(--ep-ink)]">
          Approve submission
        </h3>
        <p className="mt-2 text-sm text-[var(--ep-graphite)]">
          You&apos;re approving this KYC submission. Type <strong>APPROVE</strong> to confirm.
        </p>
        <label
          htmlFor="approve-confirm-typed"
          className="mt-4 block text-xs font-medium tracking-wide text-[var(--ep-graphite)] uppercase"
        >
          Confirmation
        </label>
        <input
          id="approve-confirm-typed"
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Type APPROVE"
          autoComplete="off"
          autoFocus
          className="mt-1 w-full rounded-md border border-[var(--ep-line)] px-3 py-2 text-sm text-[var(--ep-ink)]"
        />
        {errorMessage ? (
          <p role="alert" className="mt-2 text-xs text-[var(--ep-rose)]">
            {errorMessage}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--ep-line)] px-4 py-2 text-sm text-[var(--ep-ink)] hover:bg-[var(--ep-mist)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onSubmit}
            className="rounded-md bg-[var(--ep-mint)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? 'Approving…' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RejectModal({
  onClose,
  onSubmit,
  isPending,
  errorMessage,
}: {
  onClose: () => void
  onSubmit: (reason: string, category?: RejectionCategory) => void
  isPending: boolean
  errorMessage: string | null
}) {
  const [reason, setReason] = useState('')
  const [category, setCategory] = useState<RejectionCategory | ''>('')
  const canSubmit = reason.trim().length >= 10 && reason.length <= 1000 && !isPending

  // ESC closes the dialog (same rationale as ApproveModal).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 id="reject-modal-title" className="text-lg font-semibold text-[var(--ep-ink)]">
          Reject submission
        </h3>
        <p className="mt-2 text-sm text-[var(--ep-graphite)]">
          The reason will be sent verbatim to the tenant in the rejection email.
        </p>

        <label
          htmlFor="reject-reason"
          className="mt-4 block text-xs font-medium tracking-wide text-[var(--ep-graphite)] uppercase"
        >
          Reason (10–1000 chars)
        </label>
        <textarea
          id="reject-reason"
          rows={5}
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. NID image is too blurry to read the number; please reupload with clear lighting."
          className="mt-1 w-full rounded-md border border-[var(--ep-line)] px-3 py-2 text-sm text-[var(--ep-ink)]"
        />
        <p className="text-right text-xs text-[var(--ep-graphite)]">{reason.length} / 1000</p>

        <label
          htmlFor="reject-category"
          className="mt-2 block text-xs font-medium tracking-wide text-[var(--ep-graphite)] uppercase"
        >
          Category (optional, internal analytics only)
        </label>
        <select
          id="reject-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as RejectionCategory | '')}
          className="mt-1 w-full rounded-md border border-[var(--ep-line)] bg-white px-3 py-2 text-sm text-[var(--ep-ink)]"
        >
          <option value="">— none —</option>
          {REJECTION_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {errorMessage ? (
          <p role="alert" className="mt-2 text-xs text-[var(--ep-rose)]">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--ep-line)] px-4 py-2 text-sm text-[var(--ep-ink)] hover:bg-[var(--ep-mist)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit(reason, category === '' ? undefined : category)}
            className="rounded-md bg-[var(--ep-rose)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DecisionActions({ submissionId, submissionType, status, checklist }: Props) {
  const [openModal, setOpenModal] = useState<'approve' | 'reject' | null>(null)
  const mutation = useDecideSubmission(submissionId)

  // Refs on the trigger buttons so closeModal can restore focus per
  // WCAG 2.1 SC 2.4.3 — without this a keyboard-only reviewer loses
  // their position on the page when a modal closes.
  const approveBtnRef = useRef<HTMLButtonElement>(null)
  const rejectBtnRef = useRef<HTMLButtonElement>(null)

  const requiredKeys = requiredChecklistKeysFor(submissionType)
  const missingKeys = requiredKeys.filter((k) => !checklist[k]?.checked)
  const isApproveDisabled = missingKeys.length > 0 || status === 'approved' || status === 'rejected'
  const isRejectDisabled = status === 'approved' || status === 'rejected'

  // Surface conflict-of-interest 409 errors clearly per user brief §2.3.
  const errMessage =
    mutation.error && (mutation.error as Error & { code?: string }).code === 'CONFLICT_OF_INTEREST'
      ? 'You participated as the tenant on this submission. Another reviewer must approve.'
      : mutation.error &&
          (mutation.error as Error & { code?: string }).code === 'CHECKLIST_INCOMPLETE'
        ? 'Some required checklist items are not yet ticked. Please complete them.'
        : ((mutation.error as Error | null)?.message ?? null)

  function closeAndRestoreFocus(which: 'approve' | 'reject') {
    mutation.reset()
    setOpenModal(null)
    // Restore focus to the trigger button per WCAG 2.1 SC 2.4.3.
    // Defer to next tick so the modal unmounts first.
    setTimeout(() => {
      if (which === 'approve') approveBtnRef.current?.focus()
      else rejectBtnRef.current?.focus()
    }, 0)
  }

  function handleApprove() {
    mutation.mutate(
      { action: 'approve' },
      {
        onSuccess: () => closeAndRestoreFocus('approve'),
      },
    )
  }

  function handleReject(reason: string, category?: RejectionCategory) {
    mutation.mutate(
      { action: 'reject', reason, ...(category ? { category } : {}) },
      {
        onSuccess: () => closeAndRestoreFocus('reject'),
      },
    )
  }

  return (
    <section
      aria-labelledby="decision-actions-heading"
      className="rounded-2xl border border-[var(--ep-line)] bg-white/60 p-5"
    >
      <h3 id="decision-actions-heading" className="text-base font-semibold text-[var(--ep-ink)]">
        Decision
      </h3>

      {status === 'approved' || status === 'rejected' ? (
        <p className="mt-2 text-sm text-[var(--ep-graphite)]">
          This submission has been <strong>{status}</strong>. Decisions are not reversible from this
          UI.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-[var(--ep-graphite)]">
            {missingKeys.length > 0 ? (
              <>
                <strong>{missingKeys.length}</strong> checklist item
                {missingKeys.length === 1 ? '' : 's'} unverified. Approve is disabled until all
                required keys are checked.
              </>
            ) : (
              'All required checklist items verified. Ready to decide.'
            )}
          </p>
          <div className="mt-4 flex gap-3">
            <button
              ref={approveBtnRef}
              type="button"
              disabled={isApproveDisabled}
              onClick={() => setOpenModal('approve')}
              className="rounded-md bg-[var(--ep-mint)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Approve
            </button>
            <button
              ref={rejectBtnRef}
              type="button"
              disabled={isRejectDisabled}
              onClick={() => setOpenModal('reject')}
              className="rounded-md border border-[var(--ep-rose)] px-4 py-2 text-sm font-semibold text-[var(--ep-rose)] hover:bg-[var(--ep-rose)]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reject
            </button>
          </div>
          {errMessage && !openModal ? (
            <p role="alert" className="mt-2 text-xs text-[var(--ep-rose)]">
              {errMessage}
            </p>
          ) : null}
        </>
      )}

      {openModal === 'approve' ? (
        <ApproveModal
          onClose={() => closeAndRestoreFocus('approve')}
          onSubmit={handleApprove}
          isPending={mutation.isPending}
          errorMessage={errMessage}
        />
      ) : null}
      {openModal === 'reject' ? (
        <RejectModal
          onClose={() => closeAndRestoreFocus('reject')}
          onSubmit={handleReject}
          isPending={mutation.isPending}
          errorMessage={errMessage}
        />
      ) : null}
    </section>
  )
}

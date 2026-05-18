'use client'

/**
 * ReviewerNotes — Sprint 2 Day 18 Item 13 PR 4.
 *
 * Free-text textarea for the reviewer's unstructured observations
 * (Decision I). Auto-save on blur (no debounce; reviewer typically
 * types a complete thought then clicks away). "Saved" indicator
 * surfaces briefly.
 *
 * Notes are NOT shown to the tenant per Decision I — internal review
 * state only. Server-side, the PATCH writes audit_log row with the
 * notes diff truncated to 500 chars.
 */

import { useEffect, useState } from 'react'

import { useUpdateReviewerNotes } from '@/hooks/use-admin-kyc'

interface Props {
  submissionId: string
  initialNotes: string
}

export function ReviewerNotes({ submissionId, initialNotes }: Props) {
  const [notes, setNotes] = useState(initialNotes)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const mutation = useUpdateReviewerNotes(submissionId)

  // Reset local state when the submission changes.
  useEffect(() => {
    setNotes(initialNotes)
    setSavedAt(null)
  }, [submissionId, initialNotes])

  function handleBlur() {
    if (notes === initialNotes) return
    mutation.mutate(
      { notes },
      {
        onSuccess: () => setSavedAt(Date.now()),
      },
    )
  }

  return (
    <section
      aria-labelledby="reviewer-notes-heading"
      className="rounded-2xl border border-[var(--ep-line)] bg-white/60 p-5"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 id="reviewer-notes-heading" className="text-base font-semibold text-[var(--ep-ink)]">
          Reviewer notes
          <span className="ml-2 text-xs font-normal text-[var(--ep-graphite)] italic">
            Internal only — not shown to tenant
          </span>
        </h3>
        {mutation.isPending ? (
          <span className="text-xs text-[var(--ep-graphite)]">Saving…</span>
        ) : savedAt ? (
          <span className="text-xs text-[var(--ep-mint)]">Saved</span>
        ) : null}
      </header>
      <textarea
        id="reviewer-notes-textarea"
        aria-label="Reviewer notes"
        value={notes}
        maxLength={8000}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={handleBlur}
        placeholder="Record your verification process. e.g. 'Verified BIN against NBR VAT portal — active. Trade license registered 2018 but BIN is 13-digit which is the current format — consistent.'"
        rows={6}
        className="w-full resize-y rounded-md border border-[var(--ep-line)] bg-white px-3 py-2 text-sm text-[var(--ep-ink)]"
      />
      {mutation.isError ? (
        <p className="mt-2 text-xs text-[var(--ep-rose)]" role="alert">
          Failed to save notes: {(mutation.error as Error).message}
        </p>
      ) : null}
      <p className="mt-1 text-right text-xs text-[var(--ep-graphite)]">{notes.length} / 8000</p>
    </section>
  )
}

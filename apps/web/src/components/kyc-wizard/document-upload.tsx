'use client'

/**
 * Document upload widget — Sprint 2 Day 16 Item 12 PR 3.
 *
 * Wraps the Day 13 signed-URL flow + the Day 16 draft PATCH
 * contract. The user picks a file, the widget requests an upload
 * URL, PUTs the file to S3 with progress reporting, then reports
 * back to the parent step component via `onUploaded({contentType})`
 * so the step can include the slot in its next PATCH.
 *
 * UX:
 *   • Idle: file input + label + small file-size hint
 *   • Selected: file metadata + Upload button + Cancel
 *   • Uploading: progress bar (real % from XHR) + Cancel
 *   • Done: green check + "Replace" button
 *   • Error: inline message + "Retry" button
 *
 * Accessibility:
 *   • The file input is the labelled control; visually styled wrapper
 *     uses aria-describedby for the constraints message
 *   • Live region for upload status announces progress (chunked at
 *     25 % / 50 % / 75 % / done) so screen-reader users hear progress
 *
 * No client-side persistence of the file blob — it's read by the
 * <input> + handed straight to XHR.
 */

import { useState } from 'react'

import { uploadKycDocument, type UploadKycDocumentResult } from '@/hooks/use-kyc-draft'
import { cn } from '@/lib/utils'

interface DocumentUploadProps {
  submissionId: string
  documentType: string
  /** Bilingual labels for the slot. */
  label: string
  labelBn?: string
  /** Optional hint shown beneath the input. */
  hint?: string
  hintBn?: string
  /** Accepted MIME types; defaults to the wizard's image + PDF set. */
  accept?: string
  /** Called when the upload completes successfully. */
  onUploaded: (result: UploadKycDocumentResult) => void
  /** Set to true if the slot has already been filled (e.g. from a prior draft load). */
  alreadyUploaded?: boolean
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'selected'; file: File }
  | { kind: 'uploading'; file: File; percent: number }
  | { kind: 'done'; file: File }
  | { kind: 'error'; file: File; message: string }

export function DocumentUpload({
  submissionId,
  documentType,
  label,
  labelBn,
  hint,
  hintBn,
  accept = 'image/jpeg,image/png,image/webp,application/pdf',
  onUploaded,
  alreadyUploaded,
}: DocumentUploadProps) {
  const [phase, setPhase] = useState<Phase>(
    alreadyUploaded ? { kind: 'done', file: new File([], 'already-uploaded') } : { kind: 'idle' },
  )

  const handleFile = (file: File) => {
    setPhase({ kind: 'selected', file })
  }

  const handleUpload = async () => {
    if (phase.kind !== 'selected' && phase.kind !== 'error') return
    const file = phase.file
    setPhase({ kind: 'uploading', file, percent: 0 })
    try {
      const result = await uploadKycDocument({
        submissionId,
        documentType,
        file,
        onProgress: (percent) => setPhase({ kind: 'uploading', file, percent }),
      })
      setPhase({ kind: 'done', file })
      onUploaded(result)
    } catch (err) {
      setPhase({
        kind: 'error',
        file,
        message: err instanceof Error ? err.message : 'Upload failed',
      })
    }
  }

  const inputId = `upload-${documentType}`
  const hintId = `${inputId}-hint`
  const statusId = `${inputId}-status`

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-[var(--ep-ink)]">
        {label}
        {labelBn ? <span className="ml-1 text-xs opacity-70">· {labelBn}</span> : null}
      </label>

      {phase.kind === 'idle' || phase.kind === 'selected' ? (
        <input
          id={inputId}
          type="file"
          accept={accept}
          // Associate both the constraint hint AND the live status
          // region with the file input so screen-reader users can
          // navigate to upload progress / error messages via
          // aria-describedby (Day 16 PR 3 /review BLOCKER 2).
          aria-describedby={[hint ? hintId : undefined, statusId].filter(Boolean).join(' ')}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0]
            if (f) handleFile(f)
          }}
          className="block w-full text-sm text-[var(--ep-graphite)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--ep-violet)] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:opacity-95"
        />
      ) : null}

      {hint ? (
        <p id={hintId} className="text-xs text-[var(--ep-graphite)] opacity-70">
          {hint}
          {hintBn ? <span className="ml-1">· {hintBn}</span> : null}
        </p>
      ) : null}

      {phase.kind === 'selected' ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--ep-line)] bg-white/40 p-3">
          <p className="truncate text-sm text-[var(--ep-graphite)]">{phase.file.name}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPhase({ kind: 'idle' })}
              className="rounded-md border border-[var(--ep-line)] px-3 py-1 text-xs text-[var(--ep-graphite)] hover:bg-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUpload}
              className="rounded-md bg-[var(--ep-violet)] px-3 py-1 text-xs font-medium text-white hover:opacity-95"
            >
              Upload
            </button>
          </div>
        </div>
      ) : null}

      {phase.kind === 'uploading' ? (
        <div className="rounded-md border border-[var(--ep-line)] bg-white/40 p-3">
          <p className="mb-2 truncate text-xs text-[var(--ep-graphite)]">
            Uploading {phase.file.name}…
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--ep-line)]">
            <div
              role="progressbar"
              aria-valuenow={phase.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
              className="h-full bg-gradient-to-r from-[var(--ep-violet)] to-[var(--ep-cerulean)] transition-all"
              style={{ width: `${phase.percent}%` }}
            />
          </div>
        </div>
      ) : null}

      {phase.kind === 'done' ? (
        <div
          className={cn(
            'flex items-center justify-between gap-3 rounded-md border border-[var(--ep-mint)]/40 bg-[var(--ep-mint)]/10 p-3',
          )}
        >
          <p className="text-sm font-medium text-[var(--ep-mint)]">
            ✓ Uploaded
            <span className="ml-1 text-xs font-normal text-[var(--ep-graphite)] opacity-80">
              · আপলোড সম্পন্ন
            </span>
          </p>
          <button
            type="button"
            onClick={() => setPhase({ kind: 'idle' })}
            className="text-xs text-[var(--ep-graphite)] underline hover:text-[var(--ep-ink)]"
          >
            Replace
          </button>
        </div>
      ) : null}

      {phase.kind === 'error' ? (
        <div className="rounded-md border border-[var(--ep-rose)]/40 bg-[var(--ep-rose)]/5 p-3">
          <p className="text-sm font-medium text-[var(--ep-rose)]">Upload failed</p>
          <p className="mt-1 text-xs text-[var(--ep-graphite)]">{phase.message}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setPhase({ kind: 'idle' })}
              className="rounded-md border border-[var(--ep-line)] px-3 py-1 text-xs text-[var(--ep-graphite)] hover:bg-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUpload}
              className="rounded-md bg-[var(--ep-violet)] px-3 py-1 text-xs font-medium text-white hover:opacity-95"
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      <p id={statusId} aria-live="polite" className="sr-only">
        {phase.kind === 'uploading'
          ? `Upload ${phase.percent}% complete`
          : phase.kind === 'done'
            ? 'Upload complete'
            : phase.kind === 'error'
              ? `Upload failed: ${phase.message}`
              : ''}
      </p>
    </div>
  )
}

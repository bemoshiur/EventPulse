'use client'

/**
 * DocumentViewer — Sprint 2 Day 18 Item 13 PR 4.
 *
 * Renders each KYC document inline with a checkbox tied to the
 * reviewer checklist (Decision I). Image documents use browser-native
 * <img> (no third-party image viewer dep per Day 18 brief §2.3).
 * Reviewer can verify the image dimensions + file size are sane
 * (a 4 KB "NID image" is almost certainly fake — file metadata
 * surfaced below each preview).
 *
 * Document type → checklist key mapping is per Decision I's
 * REQUIRED_CHECKLIST_KEYS contract. The viewer ALSO surfaces
 * non-required documents (if any are present) without checkboxes —
 * Tier 2/3/B/C may add documents that don't need to be checked.
 */

import { useState } from 'react'

import { useToggleChecklistItem, type KycSubmissionDetailRow } from '@/hooks/use-admin-kyc'

const DOC_TO_CHECKLIST_KEY: Record<string, string | undefined> = {
  nid_front: 'nid_front',
  nid_back: 'nid_back',
  selfie: 'selfie',
  photograph: 'selfie',
  trade_license: 'trade_license',
  moa: 'moa',
  aoa: 'aoa',
  rjsc_certificate: 'rjsc_certificate',
  board_resolution: 'board_resolution',
  signatory_nid_front: 'signatory_nid_front',
  signatory_nid_back: 'signatory_nid_back',
  signatory_selfie: 'signatory_selfie',
  address_proof: 'address_proof',
  etin_certificate: undefined, // no checklist key for the cert itself; eTIN format checked separately
}

const DOC_LABELS: Record<string, string> = {
  nid_front: 'NID front',
  nid_back: 'NID back',
  selfie: 'Selfie',
  photograph: 'Photograph',
  trade_license: 'Trade license',
  moa: 'Memorandum of Association',
  aoa: 'Articles of Association',
  rjsc_certificate: 'RJSC certificate',
  board_resolution: 'Board resolution',
  signatory_nid_front: 'Signatory NID front',
  signatory_nid_back: 'Signatory NID back',
  signatory_selfie: 'Signatory photograph',
  address_proof: 'Address proof',
  etin_certificate: 'eTIN certificate',
}

function isImage(s3Uri: string): boolean {
  return /\.(jpe?g|png|webp)(\?|$)/i.test(s3Uri)
}

function getDocLabel(docType: string): string {
  return DOC_LABELS[docType] ?? docType
}

interface DocumentPreviewProps {
  docType: string
  signedUrl: string | undefined
  checklistKey: string | undefined
  isChecked: boolean
  onToggle: (key: string, checked: boolean) => void
}

function DocumentPreview({
  docType,
  signedUrl,
  checklistKey,
  isChecked,
  onToggle,
}: DocumentPreviewProps) {
  const [dimensions, setDimensions] = useState<string | null>(null)

  return (
    <article className="rounded-2xl border border-[var(--color-mkt-line)] bg-white p-4">
      <header className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[var(--color-mkt-ink)]">
          {getDocLabel(docType)}
        </h4>
        {checklistKey ? (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-mkt-slate)]">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={(e) => onToggle(checklistKey, e.target.checked)}
              className="h-4 w-4 rounded border-[var(--color-mkt-line)]"
              aria-label={`Verified: ${getDocLabel(docType)}`}
            />
            Verified
          </label>
        ) : null}
      </header>

      {signedUrl ? (
        isImage(signedUrl) ? (
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element -- intentional per Day 18 brief §2.3 (no third-party image viewer dep; KYC signed-GET URLs cannot use next/image's loader without proxying through the API) */}
            <img
              src={signedUrl}
              alt={`${getDocLabel(docType)} for this submission`}
              className="max-h-96 w-full rounded-md border border-[var(--color-mkt-line)] object-contain"
              onLoad={(e) => {
                const img = e.currentTarget
                setDimensions(`${img.naturalWidth} × ${img.naturalHeight}`)
              }}
            />
            {dimensions ? (
              <p className="mt-1 text-xs text-[var(--color-mkt-slate)]">
                Dimensions: {dimensions}px
              </p>
            ) : null}
          </div>
        ) : (
          <a
            href={signedUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded-md bg-[var(--color-mkt-red)]/10 px-3 py-2 text-sm text-[var(--color-mkt-red)] hover:bg-[var(--color-mkt-red)]/20"
          >
            Open PDF in new tab ↗
          </a>
        )
      ) : (
        <p className="text-sm text-[var(--color-mkt-red)] italic">No signed URL available.</p>
      )}
    </article>
  )
}

interface DocumentViewerProps {
  documents: Record<string, string>
  signedDocuments: KycSubmissionDetailRow['signedDocuments']
  submissionId: string
  /** Reserved for future per-tier document filtering (Tier 2/3/B/C);
   *  currently unused — DOC_TO_CHECKLIST_KEY covers both shapes. */
  submissionType: 'individual' | 'organisation'
  checklist: KycSubmissionDetailRow['reviewerChecklist']
}

export function DocumentViewer({
  documents,
  signedDocuments,
  submissionId,
  // submissionType reserved for future per-tier doc filtering; suppress lint
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  submissionType,
  checklist,
}: DocumentViewerProps) {
  void submissionType
  const toggle = useToggleChecklistItem(submissionId)

  function handleToggle(key: string, checked: boolean) {
    toggle.mutate({ key, checked })
  }

  const docTypes = Object.keys(documents)
  if (docTypes.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--color-mkt-line)] bg-white p-6 text-sm text-[var(--color-mkt-slate)]">
        No documents uploaded.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {docTypes.map((docType) => {
        const checklistKey = DOC_TO_CHECKLIST_KEY[docType]
        const isChecked = checklistKey ? Boolean(checklist[checklistKey]?.checked) : false
        return (
          <DocumentPreview
            key={docType}
            docType={docType}
            signedUrl={signedDocuments[docType]?.url}
            checklistKey={checklistKey}
            isChecked={isChecked}
            onToggle={handleToggle}
          />
        )
      })}
    </div>
  )
}

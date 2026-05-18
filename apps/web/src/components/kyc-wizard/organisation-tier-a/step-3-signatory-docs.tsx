'use client'

/**
 * Document-only step — Sprint 2 Day 17 Item 12 Part 2.
 *
 * The signatory's NID images + selfie. Mirror of Individual Tier 1's
 * Step 1's document section but lifted into its own step per Decision D
 * (decisions.md 2026-05-19 "Organisation Tier A wizard — 6-step
 * decomposition"). No form fields; the wizard's CTA on this step
 * proceeds directly without form validation.
 */

import { DocumentUpload } from '../document-upload'

interface Step3SignatoryDocsProps {
  submissionId: string
  uploadedDocs: Record<string, boolean>
  onUploaded: (docType: 'nid_front' | 'nid_back' | 'photograph', contentType: string) => void
}

export function Step3SignatoryDocs({
  submissionId,
  uploadedDocs,
  onUploaded,
}: Step3SignatoryDocsProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--ep-graphite)]">
        Upload the signatory&apos;s NID and a clear selfie photo.
        <span className="ml-1 opacity-70">· স্বাক্ষরকারীর এনআইডি ও সেলফি আপলোড করুন।</span>
      </p>

      <DocumentUpload
        submissionId={submissionId}
        documentType="nid_front"
        label="NID front"
        labelBn="এনআইডির সামনের পাশ"
        hint="JPG, PNG, WebP, or PDF. Max 10 MB."
        hintBn="JPG, PNG, WebP বা PDF। সর্বোচ্চ ১০ MB।"
        alreadyUploaded={uploadedDocs['nid_front']}
        onUploaded={(r) => onUploaded('nid_front', r.contentType)}
      />
      <DocumentUpload
        submissionId={submissionId}
        documentType="nid_back"
        label="NID back"
        labelBn="এনআইডির পেছনের পাশ"
        alreadyUploaded={uploadedDocs['nid_back']}
        onUploaded={(r) => onUploaded('nid_back', r.contentType)}
      />
      <DocumentUpload
        submissionId={submissionId}
        documentType="photograph"
        label="Live selfie"
        labelBn="লাইভ সেলফি"
        hint="A recent clear photo of the signatory."
        hintBn="স্বাক্ষরকারীর একটি সাম্প্রতিক স্পষ্ট ছবি।"
        alreadyUploaded={uploadedDocs['photograph']}
        onUploaded={(r) => onUploaded('photograph', r.contentType)}
      />
    </div>
  )
}

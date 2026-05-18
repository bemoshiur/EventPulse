'use client'

/**
 * Document-only step — Sprint 2 Day 17 Item 12 Part 2.
 *
 * The organisation's three legal documents: trade license, MOA, AOA.
 * Mirror of the signatory_docs step shape; different document types.
 */

import { DocumentUpload } from '../document-upload'

interface Step4OrgDocsProps {
  submissionId: string
  uploadedDocs: Record<string, boolean>
  onUploaded: (docType: 'trade_license' | 'moa' | 'aoa', contentType: string) => void
}

export function Step4OrgDocs({ submissionId, uploadedDocs, onUploaded }: Step4OrgDocsProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--ep-graphite)]">
        Upload your organisation&apos;s legal documents.
        <span className="ml-1 opacity-70">· প্রতিষ্ঠানের আইনি দলিল আপলোড করুন।</span>
      </p>

      <DocumentUpload
        submissionId={submissionId}
        documentType="trade_license"
        label="Trade license"
        labelBn="ট্রেড লাইসেন্স"
        hint="Current valid trade license. PDF or image. Max 10 MB."
        hintBn="বর্তমান বৈধ ট্রেড লাইসেন্স। PDF বা ছবি।"
        alreadyUploaded={uploadedDocs['trade_license']}
        onUploaded={(r) => onUploaded('trade_license', r.contentType)}
      />
      <DocumentUpload
        submissionId={submissionId}
        documentType="moa"
        label="Memorandum of Association (MOA)"
        labelBn="স্মারকলিপি (এমওএ)"
        hint="Signed MOA. PDF preferred."
        hintBn="সাইন করা এমওএ। PDF প্রাধান্যযোগ্য।"
        alreadyUploaded={uploadedDocs['moa']}
        onUploaded={(r) => onUploaded('moa', r.contentType)}
      />
      <DocumentUpload
        submissionId={submissionId}
        documentType="aoa"
        label="Articles of Association (AOA)"
        labelBn="সংঘবিধি (এওএ)"
        hint="Signed AOA. PDF preferred."
        hintBn="সাইন করা এওএ। PDF প্রাধান্যযোগ্য।"
        alreadyUploaded={uploadedDocs['aoa']}
        onUploaded={(r) => onUploaded('aoa', r.contentType)}
      />
    </div>
  )
}

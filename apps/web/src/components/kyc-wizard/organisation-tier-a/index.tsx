'use client'

/**
 * Organisation Tier A wizard variant — Sprint 2 Day 17 Item 12 Part 2.
 *
 * Orchestrates the 6-step Org Tier A flow per `.claude/memory/
 * decisions.md` 2026-05-19:
 *
 *   1. Org info — legal name, trade license, BIN, date of incorporation
 *   2. Signatory identity — fullName, NID number
 *   3. Signatory docs — NID front/back + photograph
 *   4. Org docs — trade license + MOA + AOA
 *   5. Financial — bank/MFS + eTIN (reuses Individual Tier 1's Step3Financial)
 *   6. Review — read-only summary, submit
 *
 * Mirror of `IndividualTier1Wizard` shape; both share `WizardFrame` +
 * `ProgressIndicator` + `DocumentUpload` + `use-kyc-draft` hook.
 *
 * sessionStorage discipline: holds only the random submissionId (NOT
 * PII; tenantship enforced by server JWT). KYC field values NEVER
 * touch sessionStorage — they live in react-hook-form's in-memory
 * state + the server's draft row.
 */

import { useEffect, useState } from 'react'

import type {
  IndividualTier1Financial,
  OrganisationTierAOrgInfo,
  OrganisationTierASignatory,
} from '@eventpulse/shared-types'

import {
  useCreateKycDraft,
  useKycDraft,
  usePatchKycDraft,
  useSubmitKycDraft,
} from '@/hooks/use-kyc-draft'

import { Step3Financial } from '../individual-tier1/step-3-financial'
import { WizardFrame } from '../wizard-frame'
import { Step1OrgInfo } from './step-1-org-info'
import { Step2SignatoryIdentity } from './step-2-signatory-identity'
import { Step3SignatoryDocs } from './step-3-signatory-docs'
import { Step4OrgDocs } from './step-4-org-docs'
import { Step6Review } from './step-6-review'

const SESSION_KEY = 'eventpulse:kyc:organisation-tier-a:submissionId'

const STEPS = [
  { id: 'org_info', label: 'Org info', labelBn: 'প্রতিষ্ঠান' },
  { id: 'signatory_identity', label: 'Signatory', labelBn: 'স্বাক্ষরকারী' },
  { id: 'signatory_docs', label: 'Signatory docs', labelBn: 'এনআইডি' },
  { id: 'org_docs', label: 'Org docs', labelBn: 'দলিল' },
  { id: 'financial', label: 'Financial', labelBn: 'আর্থিক' },
  { id: 'review', label: 'Review', labelBn: 'যাচাই' },
] as const

const WIZARD_FORM_ID = 'kyc-wizard-step-form'

function getOrCreateSubmissionId(): string {
  if (typeof window === 'undefined') return ''
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    window.sessionStorage.setItem(SESSION_KEY, fresh)
    return fresh
  } catch {
    return crypto.randomUUID()
  }
}

export function OrganisationTierAWizard() {
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    setSubmissionId(getOrCreateSubmissionId())
  }, [])

  const createDraft = useCreateKycDraft()
  const { draft } = useKycDraft(submissionId, Boolean(submissionId))
  const patchDraft = usePatchKycDraft()
  const submitDraft = useSubmitKycDraft()

  useEffect(() => {
    if (!submissionId) return
    if (createDraft.isSuccess || createDraft.isPending || createDraft.isError) return
    createDraft.mutate(submissionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally fires once on id resolution
  }, [submissionId])

  // ─── per-step submit handlers ──────────────────────────────────────

  const handleOrgInfoSubmit = async (values: OrganisationTierAOrgInfo) => {
    if (!submissionId) return
    await patchDraft.mutateAsync({
      submissionId,
      body: { step: 'org_info', fields: values },
    })
    setCurrentStepIndex(1)
  }

  const handleSignatoryIdentitySubmit = async (values: OrganisationTierASignatory) => {
    if (!submissionId) return
    await patchDraft.mutateAsync({
      submissionId,
      body: { step: 'signatory_identity', fields: values },
    })
    setCurrentStepIndex(2)
  }

  // Document-only steps don't have a form — just advance.
  const advance = () => setCurrentStepIndex((i) => i + 1)

  const handleFinancialSubmit = async (values: IndividualTier1Financial) => {
    if (!submissionId) return
    await patchDraft.mutateAsync({
      submissionId,
      body: { step: 'financial', fields: values },
    })
    setCurrentStepIndex(5)
  }

  const handleFinalSubmit = async () => {
    if (!submissionId) return
    setSubmitError(null)
    try {
      await submitDraft.mutateAsync(submissionId)
      try {
        window.sessionStorage.removeItem(SESSION_KEY)
      } catch {
        // ignored
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Submission failed. Please check each step and try again.',
      )
    }
  }

  // ─── document upload tracking ──────────────────────────────────────
  //
  // Per Day 16 PR 3 /review BLOCKER 1: document-only PATCH MUST omit
  // `fields` entirely, otherwise server's `||` shallow-merge would wipe
  // the step's prior typed values. Schema's `fields: z.never().optional()`
  // on document-only branches enforces this at the type level too.

  const handleSignatoryDocUploaded = async (
    docType: 'nid_front' | 'nid_back' | 'photograph',
    contentType: string,
  ) => {
    if (!submissionId) return
    await patchDraft.mutateAsync({
      submissionId,
      body: { step: 'signatory_docs', documents: { [docType]: { contentType } } },
    })
  }

  const handleOrgDocUploaded = async (
    docType: 'trade_license' | 'moa' | 'aoa',
    contentType: string,
  ) => {
    if (!submissionId) return
    await patchDraft.mutateAsync({
      submissionId,
      body: { step: 'org_docs', documents: { [docType]: { contentType } } },
    })
  }

  // ─── render ────────────────────────────────────────────────────────

  if (!submissionId || !draft) {
    return (
      <WizardFrame
        title="Verify your organisation"
        titleBn="আপনার প্রতিষ্ঠান যাচাই করুন"
        steps={[...STEPS]}
        currentStepIndex={0}
        primaryLabel="Loading…"
        primaryLabelBn=""
        isPrimaryDisabled
      >
        <div className="h-32 animate-pulse rounded-md bg-[var(--ep-line)]/40" />
      </WizardFrame>
    )
  }

  if (draft.status === 'submitted') {
    return (
      <WizardFrame
        title="Submission received"
        titleBn="জমা গৃহীত হয়েছে"
        steps={[...STEPS]}
        currentStepIndex={5}
        completedStepIds={STEPS.slice(0, 5).map((s) => s.id)}
        primaryLabel="Back to dashboard"
        primaryLabelBn="ড্যাশবোর্ডে ফিরে যান"
        onPrimary={() => {
          window.location.href = '/dashboard'
        }}
      >
        <p className="text-sm text-[var(--ep-graphite)]">
          Thanks — your KYC submission is now under review. We&apos;ll email you when the review
          completes (usually within 1 business day).
          <span className="ml-1 opacity-70">· আপনার কেওয়াইসি জমা পর্যালোচনাধীন।</span>
        </p>
      </WizardFrame>
    )
  }

  const docs = draft.documents
  const uploadedDocs: Record<string, boolean> = {
    nid_front: Boolean(docs['nid_front']),
    nid_back: Boolean(docs['nid_back']),
    photograph: Boolean(docs['photograph']),
    trade_license: Boolean(docs['trade_license']),
    moa: Boolean(docs['moa']),
    aoa: Boolean(docs['aoa']),
  }

  // The jsonb keys under `draft.fields` are the SHORTENED forms per
  // the server's `fieldsKeyForStep` mapping (apps/api/src/routes/tenant/
  // kyc-drafts.ts). The wizard's PATCH bodies send the VERBOSE step
  // names (`org_info`, `signatory_identity`) but the server stores
  // under shortened keys (`fields.org`, `fields.signatory`). Per
  // decisions.md 2026-05-19 "Organisation Tier A — 6-step decomposition"
  // step→jsonb-key mapping table. PR 1 integration test
  // "PATCH org_info step writes fields.org sub-object (not fields.org_info)"
  // pins this contract; the read keys here MUST match the table.
  const orgValues = (draft.fields['org'] ?? {}) as Partial<OrganisationTierAOrgInfo>
  const signatoryValues = (draft.fields['signatory'] ?? {}) as Partial<OrganisationTierASignatory>
  const financialValues = (draft.fields['financial'] ?? {}) as Partial<IndividualTier1Financial>

  // Document-only step completion booleans — used both for the
  // progress indicator's mint check AND the BLOCKER 1 fix: the
  // wizard's primary CTA on document-only steps (currentStepIndex
  // 2 or 3) must be DISABLED until all required documents for that
  // step are uploaded. Without this guard a user can click Save &
  // Continue six times with zero docs uploaded, surprise-fail at
  // submit. Per Day 17 PR 2 /review BLOCKER 1.
  const signatoryDocsComplete =
    uploadedDocs['nid_front'] && uploadedDocs['nid_back'] && uploadedDocs['photograph']
  const orgDocsComplete =
    uploadedDocs['trade_license'] && uploadedDocs['moa'] && uploadedDocs['aoa']

  // Step completion heuristic — used by progress-indicator's mint check
  // marks. A step is "complete" once its fields key has at least one
  // value (text steps) OR its required doc count is met (doc steps).
  // Reuses the signatoryDocsComplete / orgDocsComplete booleans above.
  const completedStepIds = [
    Object.keys(orgValues).length > 0 ? 'org_info' : null,
    Object.keys(signatoryValues).length > 0 ? 'signatory_identity' : null,
    signatoryDocsComplete ? 'signatory_docs' : null,
    orgDocsComplete ? 'org_docs' : null,
    Object.keys(financialValues).length > 0 ? 'financial' : null,
  ].filter(Boolean) as string[]

  let stepContent: React.ReactNode = null
  switch (currentStepIndex) {
    case 0:
      stepContent = (
        <Step1OrgInfo
          formId={WIZARD_FORM_ID}
          initialValues={orgValues}
          onValidSubmit={handleOrgInfoSubmit}
        />
      )
      break
    case 1:
      stepContent = (
        <Step2SignatoryIdentity
          formId={WIZARD_FORM_ID}
          initialValues={signatoryValues}
          onValidSubmit={handleSignatoryIdentitySubmit}
        />
      )
      break
    case 2:
      stepContent = (
        <Step3SignatoryDocs
          submissionId={submissionId}
          uploadedDocs={uploadedDocs}
          onUploaded={(t, ct) => void handleSignatoryDocUploaded(t, ct)}
        />
      )
      break
    case 3:
      stepContent = (
        <Step4OrgDocs
          submissionId={submissionId}
          uploadedDocs={uploadedDocs}
          onUploaded={(t, ct) => void handleOrgDocUploaded(t, ct)}
        />
      )
      break
    case 4:
      stepContent = (
        <Step3Financial
          formId={WIZARD_FORM_ID}
          initialValues={financialValues}
          onValidSubmit={handleFinancialSubmit}
        />
      )
      break
    default:
      stepContent = (
        <Step6Review
          org={orgValues}
          signatory={signatoryValues}
          financial={financialValues}
          documents={docs}
          submitError={submitError}
        />
      )
  }

  const isReviewStep = currentStepIndex === 5
  const isFormStep = currentStepIndex === 0 || currentStepIndex === 1 || currentStepIndex === 4
  const isDocStep = currentStepIndex === 2 || currentStepIndex === 3
  // BLOCKER 1 (Day 17 PR 2 /review): gate the Save & Continue CTA on
  // document-only steps until ALL required documents for that step
  // are uploaded. Without this guard the user could click through
  // doc steps with zero uploads, surprise-fail at submit.
  const isPrimaryDisabled =
    isDocStep &&
    !(
      (currentStepIndex === 2 && signatoryDocsComplete) ||
      (currentStepIndex === 3 && orgDocsComplete)
    )
  const primaryLabel = isReviewStep ? 'Submit for review' : 'Save & continue'
  const primaryLabelBn = isReviewStep ? 'জমা দিন' : 'সংরক্ষণ ও পরবর্তী'

  return (
    <WizardFrame
      title="Verify your organisation"
      titleBn="আপনার প্রতিষ্ঠান যাচাই করুন"
      subtitle="We need a few details to start handling money for your organisation."
      subtitleBn="প্রতিষ্ঠানের পক্ষে অর্থ পরিচালনার আগে আমাদের কিছু তথ্য দরকার।"
      steps={[...STEPS]}
      currentStepIndex={currentStepIndex}
      completedStepIds={completedStepIds}
      onBack={currentStepIndex > 0 ? () => setCurrentStepIndex(currentStepIndex - 1) : undefined}
      isBackDisabled={currentStepIndex === 0 || patchDraft.isPending}
      onPrimary={
        isReviewStep
          ? handleFinalSubmit
          : isFormStep
            ? () => {
                // Form steps: trigger the step's <form> via requestSubmit
                // so react-hook-form validates + calls onValidSubmit which
                // PATCHes + advances.
                const form = document.getElementById(WIZARD_FORM_ID) as HTMLFormElement | null
                form?.requestSubmit()
              }
            : advance
      }
      isPrimaryBusy={patchDraft.isPending || submitDraft.isPending}
      isPrimaryDisabled={isPrimaryDisabled}
      primaryLabel={primaryLabel}
      primaryLabelBn={primaryLabelBn}
    >
      {stepContent}
    </WizardFrame>
  )
}

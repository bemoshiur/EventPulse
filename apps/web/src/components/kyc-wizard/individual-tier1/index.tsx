'use client'

/**
 * Individual Tier 1 wizard variant — Sprint 2 Day 16 Item 12 PR 3.
 *
 * Orchestrates the 4-step flow:
 *   1. Identity (NID + DOB + selfie)
 *   2. Address (BD address + proof)
 *   3. Financial (bank/MFS + eTIN)
 *   4. Review + submit
 *
 * Creates the draft row on mount (idempotent via client-generated UUID
 * stored in sessionStorage — not localStorage — so a page refresh
 * within the same browser session reuses the same draft id). Each
 * step PATCHes its data; final step submits.
 *
 * Why sessionStorage for the submissionId (not localStorage): the
 * submissionId is not PII (it's a random UUID; the server enforces
 * tenant_id ownership via JWT). Storing it in sessionStorage lets the
 * user refresh mid-wizard without starting over, but it doesn't
 * persist across tabs or after the session ends — matching the user's
 * expectation of "this is in flight". PII fields (NID, DOB, etc.)
 * NEVER touch sessionStorage; they live in the server's draft row
 * + react-hook-form's in-memory state.
 */

import { useEffect, useState } from 'react'

import {
  IndividualTier1Address,
  IndividualTier1Financial,
  IndividualTier1Identity,
} from '@eventpulse/shared-types'

import {
  kycDraftQueryKey,
  useCreateKycDraft,
  useKycDraft,
  usePatchKycDraft,
  useSubmitKycDraft,
} from '@/hooks/use-kyc-draft'

import { WizardFrame } from '../wizard-frame'
import { Step1Identity } from './step-1-identity'
import { Step2Address } from './step-2-address'
import { Step3Financial } from './step-3-financial'
import { Step4Review } from './step-4-review'

const SESSION_KEY = 'eventpulse:kyc:individual-tier1:submissionId'

const STEPS = [
  { id: 'identity', label: 'Identity', labelBn: 'পরিচয়' },
  { id: 'address', label: 'Address', labelBn: 'ঠিকানা' },
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
    // sessionStorage blocked (private mode?). Fall back to a per-mount
    // UUID — refresh starts over but the wizard still works.
    return crypto.randomUUID()
  }
}

export function IndividualTier1Wizard() {
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Generate / read the submissionId after mount (window-safe).
  useEffect(() => {
    setSubmissionId(getOrCreateSubmissionId())
  }, [])

  const createDraft = useCreateKycDraft()
  const { draft } = useKycDraft(submissionId, Boolean(submissionId))
  const patchDraft = usePatchKycDraft()
  const submitDraft = useSubmitKycDraft()

  // Create the draft row exactly once after the submissionId resolves.
  // The mutation is idempotent server-side (ON CONFLICT DO NOTHING) so
  // a strict-mode double-fire is safe.
  useEffect(() => {
    if (!submissionId) return
    if (createDraft.isSuccess || createDraft.isPending || createDraft.isError) return
    createDraft.mutate(submissionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally fires once on id resolution
  }, [submissionId])

  // ─── per-step submit handlers ──────────────────────────────────────

  const handleIdentitySubmit = async (values: IndividualTier1Identity) => {
    if (!submissionId) return
    await patchDraft.mutateAsync({
      submissionId,
      body: { step: 'identity', fields: values },
    })
    setCurrentStepIndex(1)
  }

  const handleAddressSubmit = async (values: IndividualTier1Address) => {
    if (!submissionId) return
    await patchDraft.mutateAsync({
      submissionId,
      body: { step: 'address', fields: values },
    })
    setCurrentStepIndex(2)
  }

  const handleFinancialSubmit = async (values: IndividualTier1Financial) => {
    if (!submissionId) return
    await patchDraft.mutateAsync({
      submissionId,
      body: { step: 'financial', fields: values },
    })
    setCurrentStepIndex(3)
  }

  const handleFinalSubmit = async () => {
    if (!submissionId) return
    setSubmitError(null)
    try {
      await submitDraft.mutateAsync(submissionId)
      // Clear the session marker so a fresh wizard starts a new draft.
      try {
        window.sessionStorage.removeItem(SESSION_KEY)
      } catch {
        // ignored
      }
      // Stay on review step; the page renders the success state
      // because draft.status flips to 'submitted'.
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
  // The wizard reads from `draft.documents` to know which slots are
  // filled (post-PATCH the server has materialised the S3 URIs into
  // the row). The DocumentUpload component reports back via
  // `onUploaded`; the wizard PATCHes immediately so the slot persists
  // even if the user navigates away before clicking Save & Continue.

  const handleDocumentUploaded = async (
    step: 'identity' | 'address',
    docType: 'nid_front' | 'nid_back' | 'photograph' | 'address_proof',
    contentType: string,
  ) => {
    if (!submissionId) return
    // The current step's form may not be valid yet; we PATCH only the
    // documents map (with no fields) so the slot lands without
    // triggering field validation. The server's discriminated union
    // requires fields too, but per-step .partial() in the schema makes
    // empty `fields: {}` valid for the partial PATCH branches.
    await patchDraft.mutateAsync({
      submissionId,
      body: {
        step,
        fields: {},
        documents: { [docType]: { contentType } },
      },
    })
  }

  // ─── render ────────────────────────────────────────────────────────

  if (!submissionId || !draft) {
    return (
      <WizardFrame
        title="Verify your identity"
        titleBn="আপনার পরিচয় যাচাই করুন"
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
        currentStepIndex={3}
        completedStepIds={STEPS.map((s) => s.id).slice(0, 3)}
        primaryLabel="Back to dashboard"
        primaryLabelBn="ড্যাশবোর্ডে ফিরে যান"
        onPrimary={() => {
          window.location.href = '/dashboard'
        }}
      >
        <div className="space-y-2">
          <p className="text-sm text-[var(--ep-graphite)]">
            Thanks — your KYC submission is now under review. We&apos;ll email you when the review
            completes (usually within 1 business day).
            <span className="ml-1 opacity-70">· আপনার কেওয়াইসি জমা পর্যালোচনাধীন।</span>
          </p>
        </div>
      </WizardFrame>
    )
  }

  const docs = draft.documents
  const uploadedDocs: Record<string, boolean> = {
    nid_front: Boolean(docs['nid_front']),
    nid_back: Boolean(docs['nid_back']),
    photograph: Boolean(docs['photograph']),
    address_proof: Boolean(docs['address_proof']),
  }

  const identityValues = (draft.fields['identity'] ?? {}) as Partial<IndividualTier1Identity>
  const addressValues = (draft.fields['address'] ?? {}) as Partial<IndividualTier1Address>
  const financialValues = (draft.fields['financial'] ?? {}) as Partial<IndividualTier1Financial>

  const completedStepIds = [
    Object.keys(identityValues).length > 0 ? 'identity' : null,
    Object.keys(addressValues).length > 0 ? 'address' : null,
    Object.keys(financialValues).length > 0 ? 'financial' : null,
  ].filter(Boolean) as string[]

  let stepContent: React.ReactNode = null
  if (currentStepIndex === 0) {
    stepContent = (
      <Step1Identity
        submissionId={submissionId}
        formId={WIZARD_FORM_ID}
        initialValues={identityValues}
        uploadedDocs={uploadedDocs}
        onUploaded={(t, ct) => void handleDocumentUploaded('identity', t, ct)}
        onValidSubmit={handleIdentitySubmit}
      />
    )
  } else if (currentStepIndex === 1) {
    stepContent = (
      <Step2Address
        submissionId={submissionId}
        formId={WIZARD_FORM_ID}
        initialValues={addressValues}
        uploadedDocs={uploadedDocs}
        onUploaded={(t, ct) => void handleDocumentUploaded('address', t, ct)}
        onValidSubmit={handleAddressSubmit}
      />
    )
  } else if (currentStepIndex === 2) {
    stepContent = (
      <Step3Financial
        formId={WIZARD_FORM_ID}
        initialValues={financialValues}
        onValidSubmit={handleFinancialSubmit}
      />
    )
  } else {
    stepContent = (
      <Step4Review
        identity={identityValues}
        address={addressValues}
        financial={financialValues}
        documents={docs}
        submitError={submitError}
      />
    )
  }

  const isReviewStep = currentStepIndex === 3
  const primaryLabel = isReviewStep ? 'Submit for review' : 'Save & continue'
  const primaryLabelBn = isReviewStep ? 'জমা দিন' : 'সংরক্ষণ ও পরবর্তী'

  return (
    <WizardFrame
      title="Verify your identity"
      titleBn="আপনার পরিচয় যাচাই করুন"
      subtitle="We need a few details to start handling money for you."
      subtitleBn="আপনার জন্য অর্থ পরিচালনার আগে আমাদের কিছু তথ্য দরকার।"
      steps={[...STEPS]}
      currentStepIndex={currentStepIndex}
      completedStepIds={completedStepIds}
      onBack={currentStepIndex > 0 ? () => setCurrentStepIndex(currentStepIndex - 1) : undefined}
      isBackDisabled={currentStepIndex === 0 || patchDraft.isPending}
      onPrimary={
        isReviewStep
          ? handleFinalSubmit
          : () => {
              // Trigger the step's <form> submission via requestSubmit,
              // which runs react-hook-form's validation pipeline. The
              // form's onValidSubmit handler then PATCHes + advances.
              const form = document.getElementById(WIZARD_FORM_ID) as HTMLFormElement | null
              form?.requestSubmit()
            }
      }
      isPrimaryBusy={patchDraft.isPending || submitDraft.isPending}
      primaryLabel={primaryLabel}
      primaryLabelBn={primaryLabelBn}
    >
      {stepContent}
    </WizardFrame>
  )
}

// Export the query key helper for tests / callers that need it.
export { kycDraftQueryKey }

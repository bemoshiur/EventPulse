'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'

import {
  IndividualTier1IdentitySchema,
  type IndividualTier1Identity,
} from '@eventpulse/shared-types'

import { DocumentUpload } from '../document-upload'

interface Step1IdentityProps {
  submissionId: string
  formId: string
  initialValues?: Partial<IndividualTier1Identity>
  uploadedDocs: Record<string, boolean>
  onUploaded: (docType: 'nid_front' | 'nid_back' | 'photograph', contentType: string) => void
  onValidSubmit: (values: IndividualTier1Identity) => void
}

export function Step1Identity({
  submissionId,
  formId,
  initialValues,
  uploadedDocs,
  onUploaded,
  onValidSubmit,
}: Step1IdentityProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<IndividualTier1Identity>({
    resolver: zodResolver(IndividualTier1IdentitySchema),
    defaultValues: {
      fullName: initialValues?.fullName ?? '',
      dateOfBirth: initialValues?.dateOfBirth ?? '',
      nidNumber: initialValues?.nidNumber ?? '',
    },
  })

  return (
    <form id={formId} onSubmit={handleSubmit(onValidSubmit)} className="space-y-5" noValidate>
      <p className="text-sm text-[var(--ep-graphite)]">
        We need a few details from your National ID card to verify your identity.
        <span className="ml-1 opacity-70">
          · আপনার পরিচয় যাচাই করতে আমাদের আপনার এনআইডির কিছু তথ্য দরকার।
        </span>
      </p>

      <div>
        <label htmlFor="fullName" className="block text-sm font-medium text-[var(--ep-ink)]">
          Full name (as on NID) <span className="opacity-70">· পুরো নাম</span>
        </label>
        <input
          id="fullName"
          type="text"
          autoComplete="name"
          aria-invalid={errors.fullName ? 'true' : 'false'}
          aria-describedby={errors.fullName ? 'fullName-error' : undefined}
          {...register('fullName')}
          className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white/60 px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
        />
        {errors.fullName ? (
          <p id="fullName-error" className="mt-1 text-xs text-[var(--ep-rose)]">
            {errors.fullName.message}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="dateOfBirth" className="block text-sm font-medium text-[var(--ep-ink)]">
          Date of birth <span className="opacity-70">· জন্ম তারিখ</span>
        </label>
        <input
          id="dateOfBirth"
          type="date"
          autoComplete="bday"
          aria-invalid={errors.dateOfBirth ? 'true' : 'false'}
          aria-describedby={errors.dateOfBirth ? 'dob-error' : undefined}
          {...register('dateOfBirth')}
          className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white/60 px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
        />
        {errors.dateOfBirth ? (
          <p id="dob-error" className="mt-1 text-xs text-[var(--ep-rose)]">
            {errors.dateOfBirth.message}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="nidNumber" className="block text-sm font-medium text-[var(--ep-ink)]">
          NID number <span className="opacity-70">· এনআইডি নম্বর</span>
        </label>
        <input
          id="nidNumber"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={errors.nidNumber ? 'true' : 'false'}
          aria-describedby={errors.nidNumber ? 'nid-error' : undefined}
          {...register('nidNumber')}
          className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white/60 px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
        />
        {errors.nidNumber ? (
          <p id="nid-error" className="mt-1 text-xs text-[var(--ep-rose)]">
            {errors.nidNumber.message}
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-4 border-t border-[var(--ep-line)] pt-4">
        <legend className="text-sm font-medium text-[var(--ep-ink)]">
          Documents <span className="opacity-70">· দলিল</span>
        </legend>
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
          hint="A recent clear photo of yourself."
          hintBn="আপনার একটি সাম্প্রতিক স্পষ্ট ছবি।"
          alreadyUploaded={uploadedDocs['photograph']}
          onUploaded={(r) => onUploaded('photograph', r.contentType)}
        />
      </fieldset>
    </form>
  )
}

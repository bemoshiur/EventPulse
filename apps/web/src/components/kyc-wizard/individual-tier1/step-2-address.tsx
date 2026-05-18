'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'

import {
  BD_DIVISION_LABELS_BN,
  BD_DIVISION_LABELS_EN,
  BD_DIVISIONS,
  IndividualTier1AddressSchema,
  type BdDivision,
  type IndividualTier1Address,
} from '@eventpulse/shared-types'

import { DocumentUpload } from '../document-upload'

interface Step2AddressProps {
  submissionId: string
  formId: string
  initialValues?: Partial<IndividualTier1Address>
  uploadedDocs: Record<string, boolean>
  onUploaded: (docType: 'address_proof', contentType: string) => void
  onValidSubmit: (values: IndividualTier1Address) => void
}

export function Step2Address({
  submissionId,
  formId,
  initialValues,
  uploadedDocs,
  onUploaded,
  onValidSubmit,
}: Step2AddressProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<IndividualTier1Address>({
    resolver: zodResolver(IndividualTier1AddressSchema),
    defaultValues: {
      addressLine1: initialValues?.addressLine1 ?? '',
      addressLine2: initialValues?.addressLine2 ?? '',
      city: initialValues?.city ?? '',
      division: (initialValues?.division as BdDivision | undefined) ?? 'dhaka',
      postalCode: initialValues?.postalCode ?? '',
    },
  })

  return (
    <form id={formId} onSubmit={handleSubmit(onValidSubmit)} className="space-y-5" noValidate>
      <p className="text-sm text-[var(--ep-graphite)]">
        Where can we reach you?<span className="ml-1 opacity-70">· আপনি কোথায় থাকেন?</span>
      </p>

      <div>
        <label htmlFor="addressLine1" className="block text-sm font-medium text-[var(--ep-ink)]">
          Address line 1 <span className="opacity-70">· ঠিকানা লাইন ১</span>
        </label>
        <input
          id="addressLine1"
          type="text"
          autoComplete="address-line1"
          aria-invalid={errors.addressLine1 ? 'true' : 'false'}
          aria-describedby={errors.addressLine1 ? 'addressLine1-error' : undefined}
          {...register('addressLine1')}
          className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white/60 px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
        />
        {errors.addressLine1 ? (
          <p id="addressLine1-error" className="mt-1 text-xs text-[var(--ep-rose)]">
            {errors.addressLine1.message}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="addressLine2" className="block text-sm font-medium text-[var(--ep-ink)]">
          Address line 2 (optional) <span className="opacity-70">· ঠিকানা লাইন ২</span>
        </label>
        <input
          id="addressLine2"
          type="text"
          autoComplete="address-line2"
          {...register('addressLine2')}
          className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white/60 px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="city" className="block text-sm font-medium text-[var(--ep-ink)]">
            City <span className="opacity-70">· শহর</span>
          </label>
          <input
            id="city"
            type="text"
            autoComplete="address-level2"
            aria-invalid={errors.city ? 'true' : 'false'}
            aria-describedby={errors.city ? 'city-error' : undefined}
            {...register('city')}
            className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white/60 px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
          />
          {errors.city ? (
            <p id="city-error" className="mt-1 text-xs text-[var(--ep-rose)]">
              {errors.city.message}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="division" className="block text-sm font-medium text-[var(--ep-ink)]">
            Division <span className="opacity-70">· বিভাগ</span>
          </label>
          <select
            id="division"
            autoComplete="address-level1"
            aria-invalid={errors.division ? 'true' : 'false'}
            aria-describedby={errors.division ? 'division-error' : undefined}
            {...register('division')}
            className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white/60 px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
          >
            {BD_DIVISIONS.map((d) => (
              <option key={d} value={d}>
                {BD_DIVISION_LABELS_EN[d]} · {BD_DIVISION_LABELS_BN[d]}
              </option>
            ))}
          </select>
          {errors.division ? (
            <p id="division-error" className="mt-1 text-xs text-[var(--ep-rose)]">
              {errors.division.message}
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <label htmlFor="postalCode" className="block text-sm font-medium text-[var(--ep-ink)]">
          Postal code (4 digits) <span className="opacity-70">· পোস্টাল কোড</span>
        </label>
        <input
          id="postalCode"
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={4}
          aria-invalid={errors.postalCode ? 'true' : 'false'}
          aria-describedby={errors.postalCode ? 'postalCode-error' : undefined}
          {...register('postalCode')}
          className="mt-1 block w-full max-w-[10rem] rounded-md border border-[var(--ep-line)] bg-white/60 px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
        />
        {errors.postalCode ? (
          <p id="postalCode-error" className="mt-1 text-xs text-[var(--ep-rose)]">
            {errors.postalCode.message}
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-4 border-t border-[var(--ep-line)] pt-4">
        <legend className="text-sm font-medium text-[var(--ep-ink)]">
          Address proof <span className="opacity-70">· ঠিকানার প্রমাণ</span>
        </legend>
        <DocumentUpload
          submissionId={submissionId}
          documentType="address_proof"
          label="Utility bill, bank statement, or rental agreement"
          labelBn="ইউটিলিটি বিল, ব্যাংক স্টেটমেন্ট বা ভাড়ার চুক্তি"
          hint="A document showing your address from the last 3 months. JPG, PNG, WebP, or PDF."
          hintBn="গত ৩ মাসের মধ্যে আপনার ঠিকানা দেখানো একটি দলিল।"
          alreadyUploaded={uploadedDocs['address_proof']}
          onUploaded={(r) => onUploaded('address_proof', r.contentType)}
        />
      </fieldset>
    </form>
  )
}

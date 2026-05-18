'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'

import {
  OrganisationTierASignatorySchema,
  type OrganisationTierASignatory,
} from '@eventpulse/shared-types'

interface Step2SignatoryIdentityProps {
  formId: string
  initialValues?: Partial<OrganisationTierASignatory>
  onValidSubmit: (values: OrganisationTierASignatory) => void
}

export function Step2SignatoryIdentity({
  formId,
  initialValues,
  onValidSubmit,
}: Step2SignatoryIdentityProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OrganisationTierASignatory>({
    mode: 'onBlur',
    resolver: zodResolver(OrganisationTierASignatorySchema),
    defaultValues: {
      fullName: initialValues?.fullName ?? '',
      nidNumber: initialValues?.nidNumber ?? '',
    },
  })

  return (
    <form id={formId} onSubmit={handleSubmit(onValidSubmit)} className="space-y-5" noValidate>
      <p className="text-sm text-[var(--ep-graphite)]">
        Who is the authorised signatory acting on behalf of your organisation?
        <span className="ml-1 opacity-70">· প্রতিষ্ঠানের পক্ষে কে অনুমোদিত স্বাক্ষরকারী?</span>
      </p>

      <div>
        <label htmlFor="sig-fullName" className="block text-sm font-medium text-[var(--ep-ink)]">
          Signatory full name (as on NID){' '}
          <span className="opacity-70">· স্বাক্ষরকারীর পুরো নাম</span>
        </label>
        <input
          id="sig-fullName"
          type="text"
          autoComplete="name"
          aria-invalid={errors.fullName ? 'true' : 'false'}
          aria-describedby={errors.fullName ? 'sig-fullName-error' : undefined}
          {...register('fullName')}
          className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white/60 px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
        />
        {errors.fullName ? (
          <p id="sig-fullName-error" className="mt-1 text-xs text-[var(--ep-rose)]">
            {errors.fullName.message}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="sig-nidNumber" className="block text-sm font-medium text-[var(--ep-ink)]">
          Signatory NID number <span className="opacity-70">· এনআইডি নম্বর</span>
        </label>
        <input
          id="sig-nidNumber"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={errors.nidNumber ? 'true' : 'false'}
          aria-describedby={errors.nidNumber ? 'sig-nidNumber-error' : undefined}
          {...register('nidNumber')}
          className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white/60 px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
        />
        {errors.nidNumber ? (
          <p id="sig-nidNumber-error" className="mt-1 text-xs text-[var(--ep-rose)]">
            {errors.nidNumber.message}
          </p>
        ) : null}
      </div>
    </form>
  )
}

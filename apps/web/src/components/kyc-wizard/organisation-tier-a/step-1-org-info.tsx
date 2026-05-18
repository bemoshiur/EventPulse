'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'

import {
  OrganisationTierAOrgInfoSchema,
  type OrganisationTierAOrgInfo,
} from '@eventpulse/shared-types'

interface Step1OrgInfoProps {
  formId: string
  initialValues?: Partial<OrganisationTierAOrgInfo>
  onValidSubmit: (values: OrganisationTierAOrgInfo) => void
}

export function Step1OrgInfo({ formId, initialValues, onValidSubmit }: Step1OrgInfoProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OrganisationTierAOrgInfo>({
    mode: 'onBlur',
    resolver: zodResolver(OrganisationTierAOrgInfoSchema),
    defaultValues: {
      legalName: initialValues?.legalName ?? '',
      tradeLicenseNumber: initialValues?.tradeLicenseNumber ?? '',
      bin: initialValues?.bin ?? '',
      dateOfIncorporation: initialValues?.dateOfIncorporation ?? '',
    },
  })

  return (
    <form id={formId} onSubmit={handleSubmit(onValidSubmit)} className="space-y-5" noValidate>
      <p className="text-sm text-[var(--ep-graphite)]">
        Let&apos;s start with the legal details of your organisation.
        <span className="ml-1 opacity-70">· প্রতিষ্ঠানের আইনি বিবরণ দিয়ে শুরু করি।</span>
      </p>

      <div>
        <label htmlFor="legalName" className="block text-sm font-medium text-[var(--ep-ink)]">
          Legal name <span className="opacity-70">· আইনি নাম</span>
        </label>
        <input
          id="legalName"
          type="text"
          autoComplete="organization"
          aria-invalid={errors.legalName ? 'true' : 'false'}
          aria-describedby={errors.legalName ? 'legalName-error' : undefined}
          {...register('legalName')}
          className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white/60 px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
        />
        {errors.legalName ? (
          <p id="legalName-error" className="mt-1 text-xs text-[var(--ep-rose)]">
            {errors.legalName.message}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-[var(--ep-graphite)] opacity-70">
          Exactly as it appears on your trade license.
          <span className="ml-1">· ট্রেড লাইসেন্সে যেভাবে লেখা আছে।</span>
        </p>
      </div>

      <div>
        <label
          htmlFor="tradeLicenseNumber"
          className="block text-sm font-medium text-[var(--ep-ink)]"
        >
          Trade license number <span className="opacity-70">· ট্রেড লাইসেন্স নম্বর</span>
        </label>
        <input
          id="tradeLicenseNumber"
          type="text"
          autoComplete="off"
          aria-invalid={errors.tradeLicenseNumber ? 'true' : 'false'}
          aria-describedby={errors.tradeLicenseNumber ? 'tradeLicenseNumber-error' : undefined}
          {...register('tradeLicenseNumber')}
          className="mt-1 block w-full rounded-md border border-[var(--ep-line)] bg-white/60 px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
        />
        {errors.tradeLicenseNumber ? (
          <p id="tradeLicenseNumber-error" className="mt-1 text-xs text-[var(--ep-rose)]">
            {errors.tradeLicenseNumber.message}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="bin" className="block text-sm font-medium text-[var(--ep-ink)]">
          BIN (VAT registration) <span className="opacity-70">· বিআইএন</span>
        </label>
        <input
          id="bin"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={13}
          aria-invalid={errors.bin ? 'true' : 'false'}
          aria-describedby={errors.bin ? 'bin-error' : 'bin-hint'}
          {...register('bin')}
          className="mt-1 block w-full max-w-xs rounded-md border border-[var(--ep-line)] bg-white/60 px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
        />
        {errors.bin ? (
          <p id="bin-error" className="mt-1 text-xs text-[var(--ep-rose)]">
            {errors.bin.message}
          </p>
        ) : (
          <p id="bin-hint" className="mt-1 text-xs text-[var(--ep-graphite)] opacity-70">
            13-digit e-BIN (NBR format).
            <span className="ml-1">· ১৩-অঙ্কের ই-বিআইএন।</span>
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="dateOfIncorporation"
          className="block text-sm font-medium text-[var(--ep-ink)]"
        >
          Date of incorporation <span className="opacity-70">· নিবন্ধন তারিখ</span>
        </label>
        <input
          id="dateOfIncorporation"
          type="date"
          autoComplete="off"
          aria-invalid={errors.dateOfIncorporation ? 'true' : 'false'}
          aria-describedby={errors.dateOfIncorporation ? 'doi-error' : undefined}
          {...register('dateOfIncorporation')}
          className="mt-1 block w-full max-w-xs rounded-md border border-[var(--ep-line)] bg-white/60 px-3 py-2 text-sm focus:border-[var(--ep-violet)] focus:ring-2 focus:ring-[var(--ep-cerulean)] focus:outline-none"
        />
        {errors.dateOfIncorporation ? (
          <p id="doi-error" className="mt-1 text-xs text-[var(--ep-rose)]">
            {errors.dateOfIncorporation.message}
          </p>
        ) : null}
      </div>
    </form>
  )
}

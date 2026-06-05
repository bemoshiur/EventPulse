'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'

import {
  IndividualTier1FinancialSchema,
  type IndividualTier1Financial,
} from '@eventpulse/shared-types'

interface Step3FinancialProps {
  formId: string
  initialValues?: Partial<IndividualTier1Financial>
  onValidSubmit: (values: IndividualTier1Financial) => void
}

const ACCOUNT_TYPE_LABELS: Record<
  'bank' | 'bkash' | 'nagad' | 'rocket' | 'upay',
  { en: string; bn: string }
> = {
  bank: { en: 'Bank account', bn: 'ব্যাংক অ্যাকাউন্ট' },
  bkash: { en: 'bKash', bn: 'বিকাশ' },
  nagad: { en: 'Nagad', bn: 'নগদ' },
  rocket: { en: 'Rocket', bn: 'রকেট' },
  upay: { en: 'Upay', bn: 'উপায়' },
}

export function Step3Financial({ formId, initialValues, onValidSubmit }: Step3FinancialProps) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<IndividualTier1Financial>({
    // mode: 'onBlur' — per Day 17 polish scope (decisions.md 2026-05-19).
    mode: 'onBlur',
    resolver: zodResolver(IndividualTier1FinancialSchema),
    defaultValues: {
      accountType: initialValues?.accountType ?? 'bank',
      accountName: initialValues?.accountName ?? '',
      accountNumber: initialValues?.accountNumber ?? '',
      branchName: initialValues?.branchName ?? '',
      etinNumber: initialValues?.etinNumber ?? '',
    },
  })

  const accountType = useWatch({ control, name: 'accountType' })

  return (
    <form id={formId} onSubmit={handleSubmit(onValidSubmit)} className="space-y-5" noValidate>
      <p className="text-sm text-[var(--color-mkt-slate)]">
        Where should we send your payouts?
        <span className="ml-1 opacity-70">· পেমেন্ট কোথায় পাঠাব?</span>
      </p>

      <div>
        <label
          htmlFor="accountType"
          className="block text-sm font-medium text-[var(--color-mkt-ink)]"
        >
          Account type <span className="opacity-70">· অ্যাকাউন্টের ধরন</span>
        </label>
        <select
          id="accountType"
          aria-invalid={errors.accountType ? 'true' : 'false'}
          aria-describedby={errors.accountType ? 'accountType-error' : undefined}
          {...register('accountType')}
          className="mt-1 block w-full rounded-md border border-[var(--color-mkt-line)] bg-white px-3 py-2 text-sm focus:border-[var(--color-mkt-red)] focus:ring-2 focus:ring-[var(--color-mkt-red)] focus:outline-none"
        >
          {(Object.keys(ACCOUNT_TYPE_LABELS) as Array<keyof typeof ACCOUNT_TYPE_LABELS>).map(
            (t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t].en} · {ACCOUNT_TYPE_LABELS[t].bn}
              </option>
            ),
          )}
        </select>
        {errors.accountType ? (
          <p id="accountType-error" className="mt-1 text-xs text-[var(--color-mkt-red)]">
            {errors.accountType.message}
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="accountName"
          className="block text-sm font-medium text-[var(--color-mkt-ink)]"
        >
          Account holder name <span className="opacity-70">· অ্যাকাউন্টধারীর নাম</span>
        </label>
        <input
          id="accountName"
          type="text"
          autoComplete="name"
          aria-invalid={errors.accountName ? 'true' : 'false'}
          aria-describedby={errors.accountName ? 'accountName-error' : undefined}
          {...register('accountName')}
          className="mt-1 block w-full rounded-md border border-[var(--color-mkt-line)] bg-white px-3 py-2 text-sm focus:border-[var(--color-mkt-red)] focus:ring-2 focus:ring-[var(--color-mkt-red)] focus:outline-none"
        />
        {errors.accountName ? (
          <p id="accountName-error" className="mt-1 text-xs text-[var(--color-mkt-red)]">
            {errors.accountName.message}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-[var(--color-mkt-slate)] opacity-70">
          Must match the name on your NID.<span className="ml-1">· এনআইডির নামের সাথে মিলবে।</span>
        </p>
      </div>

      <div>
        <label
          htmlFor="accountNumber"
          className="block text-sm font-medium text-[var(--color-mkt-ink)]"
        >
          Account / wallet number <span className="opacity-70">· অ্যাকাউন্ট নম্বর</span>
        </label>
        <input
          id="accountNumber"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={errors.accountNumber ? 'true' : 'false'}
          aria-describedby={errors.accountNumber ? 'accountNumber-error' : undefined}
          {...register('accountNumber')}
          className="mt-1 block w-full rounded-md border border-[var(--color-mkt-line)] bg-white px-3 py-2 text-sm focus:border-[var(--color-mkt-red)] focus:ring-2 focus:ring-[var(--color-mkt-red)] focus:outline-none"
        />
        {errors.accountNumber ? (
          <p id="accountNumber-error" className="mt-1 text-xs text-[var(--color-mkt-red)]">
            {errors.accountNumber.message}
          </p>
        ) : null}
      </div>

      {accountType === 'bank' ? (
        <div>
          <label
            htmlFor="branchName"
            className="block text-sm font-medium text-[var(--color-mkt-ink)]"
          >
            Branch name <span className="opacity-70">· শাখার নাম</span>
          </label>
          <input
            id="branchName"
            type="text"
            autoComplete="off"
            aria-invalid={errors.branchName ? 'true' : 'false'}
            aria-describedby={errors.branchName ? 'branchName-error' : undefined}
            {...register('branchName')}
            className="mt-1 block w-full rounded-md border border-[var(--color-mkt-line)] bg-white px-3 py-2 text-sm focus:border-[var(--color-mkt-red)] focus:ring-2 focus:ring-[var(--color-mkt-red)] focus:outline-none"
          />
          {errors.branchName ? (
            <p id="branchName-error" className="mt-1 text-xs text-[var(--color-mkt-red)]">
              {errors.branchName.message}
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <label
          htmlFor="etinNumber"
          className="block text-sm font-medium text-[var(--color-mkt-ink)]"
        >
          eTIN number <span className="opacity-70">· ইটিআইএন</span>
        </label>
        <input
          id="etinNumber"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={13}
          aria-invalid={errors.etinNumber ? 'true' : 'false'}
          aria-describedby={errors.etinNumber ? 'etinNumber-error' : undefined}
          {...register('etinNumber')}
          className="mt-1 block w-full max-w-xs rounded-md border border-[var(--color-mkt-line)] bg-white px-3 py-2 text-sm focus:border-[var(--color-mkt-red)] focus:ring-2 focus:ring-[var(--color-mkt-red)] focus:outline-none"
        />
        {errors.etinNumber ? (
          <p id="etinNumber-error" className="mt-1 text-xs text-[var(--color-mkt-red)]">
            {errors.etinNumber.message}
          </p>
        ) : null}
      </div>
    </form>
  )
}

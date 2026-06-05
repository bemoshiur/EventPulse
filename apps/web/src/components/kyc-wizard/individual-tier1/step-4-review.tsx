'use client'

import type {
  BD_DIVISIONS,
  IndividualTier1Address,
  IndividualTier1Financial,
  IndividualTier1Identity,
} from '@eventpulse/shared-types'
import { BD_DIVISION_LABELS_BN, BD_DIVISION_LABELS_EN } from '@eventpulse/shared-types'

type BdDivision = (typeof BD_DIVISIONS)[number]

interface Step4ReviewProps {
  identity?: Partial<IndividualTier1Identity>
  address?: Partial<IndividualTier1Address>
  financial?: Partial<IndividualTier1Financial>
  documents: Record<string, string>
  /** Inline server-side validation errors from the submit attempt (e.g. missing fields). */
  submitError?: string | null
}

function fieldRow(label: string, labelBn: string, value: string | undefined) {
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--color-mkt-line)] py-2 last:border-b-0">
      <dt className="text-sm font-medium text-[var(--color-mkt-slate)]">
        {label} <span className="opacity-70">· {labelBn}</span>
      </dt>
      <dd className="text-sm text-[var(--color-mkt-ink)]">
        {value || <em className="opacity-50">—</em>}
      </dd>
    </div>
  )
}

function maskNid(nid?: string) {
  if (!nid) return undefined
  // Display last 4 only — even on the user's own review screen we
  // don't display the full NID, in case the screen is shared/observed.
  return `••••${nid.slice(-4)}`
}

function maskAccount(num?: string) {
  if (!num) return undefined
  return `••••${num.slice(-4)}`
}

export function Step4Review({
  identity,
  address,
  financial,
  documents,
  submitError,
}: Step4ReviewProps) {
  const requiredDocs: Array<{
    type: 'nid_front' | 'nid_back' | 'photograph' | 'address_proof'
    label: string
    labelBn: string
  }> = [
    { type: 'nid_front', label: 'NID front', labelBn: 'এনআইডি সামনে' },
    { type: 'nid_back', label: 'NID back', labelBn: 'এনআইডি পেছনে' },
    { type: 'photograph', label: 'Photograph', labelBn: 'ছবি' },
    { type: 'address_proof', label: 'Address proof', labelBn: 'ঠিকানার প্রমাণ' },
  ]

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--color-mkt-slate)]">
        Review your information before submitting. Once submitted, your application goes to our
        review team.
        <span className="ml-1 opacity-70">· জমা দেওয়ার আগে আপনার তথ্য যাচাই করুন।</span>
      </p>

      <section aria-labelledby="review-identity">
        <h3 id="review-identity" className="text-base font-semibold text-[var(--color-mkt-ink)]">
          Identity <span className="opacity-70">· পরিচয়</span>
        </h3>
        <dl className="mt-2 rounded-md border border-[var(--color-mkt-line)] bg-white px-4">
          {fieldRow('Full name', 'পুরো নাম', identity?.fullName)}
          {fieldRow('Date of birth', 'জন্ম তারিখ', identity?.dateOfBirth)}
          {fieldRow('NID number', 'এনআইডি নম্বর', maskNid(identity?.nidNumber))}
        </dl>
      </section>

      <section aria-labelledby="review-address">
        <h3 id="review-address" className="text-base font-semibold text-[var(--color-mkt-ink)]">
          Address <span className="opacity-70">· ঠিকানা</span>
        </h3>
        <dl className="mt-2 rounded-md border border-[var(--color-mkt-line)] bg-white px-4">
          {fieldRow('Address line 1', 'ঠিকানা ১', address?.addressLine1)}
          {address?.addressLine2
            ? fieldRow('Address line 2', 'ঠিকানা ২', address.addressLine2)
            : null}
          {fieldRow('City', 'শহর', address?.city)}
          {fieldRow(
            'Division',
            'বিভাগ',
            address?.division
              ? `${BD_DIVISION_LABELS_EN[address.division as BdDivision]} · ${BD_DIVISION_LABELS_BN[address.division as BdDivision]}`
              : undefined,
          )}
          {fieldRow('Postal code', 'পোস্টাল কোড', address?.postalCode)}
        </dl>
      </section>

      <section aria-labelledby="review-financial">
        <h3 id="review-financial" className="text-base font-semibold text-[var(--color-mkt-ink)]">
          Financial <span className="opacity-70">· আর্থিক</span>
        </h3>
        <dl className="mt-2 rounded-md border border-[var(--color-mkt-line)] bg-white px-4">
          {fieldRow('Account type', 'অ্যাকাউন্টের ধরন', financial?.accountType)}
          {fieldRow('Account name', 'নাম', financial?.accountName)}
          {fieldRow('Account number', 'অ্যাকাউন্ট নম্বর', maskAccount(financial?.accountNumber))}
          {financial?.branchName ? fieldRow('Branch', 'শাখা', financial.branchName) : null}
          {fieldRow('eTIN', 'ইটিআইএন', maskAccount(financial?.etinNumber))}
        </dl>
      </section>

      <section aria-labelledby="review-documents">
        <h3 id="review-documents" className="text-base font-semibold text-[var(--color-mkt-ink)]">
          Documents <span className="opacity-70">· দলিল</span>
        </h3>
        <ul className="mt-2 space-y-2">
          {requiredDocs.map((d) => {
            const uploaded = Boolean(documents[d.type])
            return (
              <li
                key={d.type}
                className="flex items-center justify-between rounded-md border border-[var(--color-mkt-line)] bg-white px-4 py-2 text-sm"
              >
                <span className="text-[var(--color-mkt-slate)]">
                  {d.label} <span className="opacity-70">· {d.labelBn}</span>
                </span>
                <span
                  className={
                    uploaded
                      ? 'text-sm font-semibold text-[#059669]'
                      : 'text-sm font-semibold text-[var(--color-mkt-red)]'
                  }
                >
                  {uploaded ? '✓ Uploaded' : '✗ Missing'}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      {submitError ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--color-mkt-red)]/40 bg-[var(--color-mkt-red)]/5 p-3 text-sm text-[var(--color-mkt-red)]"
        >
          {submitError}
        </div>
      ) : null}
    </div>
  )
}

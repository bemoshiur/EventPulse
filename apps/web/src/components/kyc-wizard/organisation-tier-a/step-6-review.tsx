'use client'

import type {
  IndividualTier1Financial,
  OrganisationTierAOrgInfo,
  OrganisationTierASignatory,
} from '@eventpulse/shared-types'

interface Step6ReviewProps {
  org?: Partial<OrganisationTierAOrgInfo>
  signatory?: Partial<OrganisationTierASignatory>
  financial?: Partial<IndividualTier1Financial>
  documents: Record<string, string>
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
  return `••••${nid.slice(-4)}`
}

function maskAccount(num?: string) {
  if (!num) return undefined
  return `••••${num.slice(-4)}`
}

export function Step6Review({
  org,
  signatory,
  financial,
  documents,
  submitError,
}: Step6ReviewProps) {
  const requiredDocs: Array<{
    type: 'nid_front' | 'nid_back' | 'photograph' | 'trade_license' | 'moa' | 'aoa'
    label: string
    labelBn: string
  }> = [
    { type: 'nid_front', label: 'Signatory NID front', labelBn: 'এনআইডি সামনে' },
    { type: 'nid_back', label: 'Signatory NID back', labelBn: 'এনআইডি পেছনে' },
    { type: 'photograph', label: 'Signatory photograph', labelBn: 'ছবি' },
    { type: 'trade_license', label: 'Trade license', labelBn: 'ট্রেড লাইসেন্স' },
    { type: 'moa', label: 'MOA', labelBn: 'এমওএ' },
    { type: 'aoa', label: 'AOA', labelBn: 'এওএ' },
  ]

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--color-mkt-slate)]">
        Review your information before submitting. Once submitted, your application goes to our
        review team.
        <span className="ml-1 opacity-70">· জমা দেওয়ার আগে আপনার তথ্য যাচাই করুন।</span>
      </p>

      <section aria-labelledby="review-org">
        <h3 id="review-org" className="text-base font-semibold text-[var(--color-mkt-ink)]">
          Organisation <span className="opacity-70">· প্রতিষ্ঠান</span>
        </h3>
        <dl className="mt-2 rounded-md border border-[var(--color-mkt-line)] bg-white px-4">
          {fieldRow('Legal name', 'আইনি নাম', org?.legalName)}
          {fieldRow('Trade license', 'ট্রেড লাইসেন্স', org?.tradeLicenseNumber)}
          {fieldRow('BIN', 'বিআইএন', org?.bin)}
          {fieldRow('Date of incorporation', 'নিবন্ধন তারিখ', org?.dateOfIncorporation)}
        </dl>
      </section>

      <section aria-labelledby="review-signatory">
        <h3 id="review-signatory" className="text-base font-semibold text-[var(--color-mkt-ink)]">
          Authorised signatory <span className="opacity-70">· অনুমোদিত স্বাক্ষরকারী</span>
        </h3>
        <dl className="mt-2 rounded-md border border-[var(--color-mkt-line)] bg-white px-4">
          {fieldRow('Full name', 'পুরো নাম', signatory?.fullName)}
          {fieldRow('NID number', 'এনআইডি নম্বর', maskNid(signatory?.nidNumber))}
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

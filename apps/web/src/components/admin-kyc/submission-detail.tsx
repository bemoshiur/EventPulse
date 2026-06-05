'use client'

/**
 * SubmissionDetail — Sprint 2 Day 18 Item 13 PR 4.
 *
 * Renders the submission's raw fields per tier. NO validation badges,
 * NO auto-flag indicators per the platform-wide manual-verification
 * policy (decisions.md 2026-05-19). Per-field helper text describes
 * the expected format as reviewer documentation.
 *
 * Each field is read-only — the reviewer's interaction with the data
 * happens through the checklist toggles next to the docs (in
 * DocumentViewer) and the free-text notes (in ReviewerNotes).
 */

import type { KycSubmissionDetailRow } from '@/hooks/use-admin-kyc'

interface FieldRowProps {
  label: string
  value: unknown
  helper?: string
}

function FieldRow({ label, value, helper }: FieldRowProps) {
  const rendered =
    value === null || value === undefined || value === ''
      ? '—'
      : typeof value === 'string'
        ? value
        : JSON.stringify(value)
  return (
    <div className="border-b border-[var(--color-mkt-line)] py-3 last:border-b-0">
      <div className="text-xs font-medium tracking-wide text-[var(--color-mkt-slate)] uppercase">
        {label}
      </div>
      <div className="mt-1 text-sm break-words text-[var(--color-mkt-ink)]">{rendered}</div>
      {helper ? (
        <div className="mt-1 text-xs text-[var(--color-mkt-slate)] italic">{helper}</div>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-mkt-line)] bg-white p-5">
      <h3 className="mb-2 text-base font-semibold text-[var(--color-mkt-ink)]">{title}</h3>
      <div>{children}</div>
    </section>
  )
}

export function SubmissionDetail({ submission }: { submission: KycSubmissionDetailRow }) {
  const fields = submission.fields as Record<string, Record<string, unknown> | undefined>

  if (submission.submissionType === 'individual') {
    const identity = fields['identity'] ?? {}
    const address = fields['address'] ?? {}
    const financial = fields['financial'] ?? {}
    return (
      <div className="space-y-4">
        <Section title="Identity">
          <FieldRow label="Full name" value={identity['fullName']} helper="Compare to NID image." />
          <FieldRow
            label="Date of birth"
            value={identity['dateOfBirth']}
            helper="Compare to NID image."
          />
          <FieldRow
            label="NID number"
            value={identity['nidNumber']}
            helper="10 or 17 digits; verify against the uploaded NID image."
          />
        </Section>
        <Section title="Address">
          <FieldRow label="Line 1" value={address['addressLine1']} />
          <FieldRow label="Line 2" value={address['addressLine2']} />
          <FieldRow label="City" value={address['city']} />
          <FieldRow label="Division" value={address['division']} />
          <FieldRow label="Postcode" value={address['postcode']} />
        </Section>
        <Section title="Financial">
          <FieldRow label="Account type" value={financial['accountType']} />
          <FieldRow
            label="Account name"
            value={financial['accountName']}
            helper="Should match NID full name; toggle the bank_account_name_match checklist key if it does."
          />
          <FieldRow label="Account number" value={financial['accountNumber']} />
          <FieldRow label="Bank name" value={financial['bankName']} />
          <FieldRow label="Branch" value={financial['branchName']} />
          <FieldRow
            label="eTIN"
            value={financial['etinNumber']}
            helper="12 digits; verify against NBR e-TIN portal at etinportal.nbr.gov.bd."
          />
        </Section>
      </div>
    )
  }

  // Organisation Tier A
  const org = fields['org'] ?? {}
  const signatory = fields['signatory'] ?? {}
  const financial = fields['financial'] ?? {}
  return (
    <div className="space-y-4">
      <Section title="Organisation">
        <FieldRow label="Legal name" value={org['legalName']} />
        <FieldRow label="Trade license number" value={org['tradeLicenseNumber']} />
        <FieldRow
          label="BIN"
          value={org['bin']}
          helper="13 digits per NBR 2019-11-30 amendment; verify against NBR VAT portal at vat.gov.bd. Legacy 9-digit BINs exist in pre-2019 documents."
        />
        <FieldRow label="Date of incorporation" value={org['dateOfIncorporation']} />
      </Section>
      <Section title="Authorised signatory">
        <FieldRow label="Full name" value={signatory['fullName']} helper="Compare to NID image." />
        <FieldRow label="NID number" value={signatory['nidNumber']} />
      </Section>
      <Section title="Financial">
        <FieldRow label="Account type" value={financial['accountType']} />
        <FieldRow
          label="Account name"
          value={financial['accountName']}
          helper="Should match the signatory or organisation name; toggle bank_account_name_match if it does."
        />
        <FieldRow label="Account number" value={financial['accountNumber']} />
        <FieldRow label="Bank name" value={financial['bankName']} />
        <FieldRow label="Branch" value={financial['branchName']} />
        <FieldRow
          label="eTIN"
          value={financial['etinNumber']}
          helper="12 digits; verify against NBR e-TIN portal at etinportal.nbr.gov.bd."
        />
      </Section>
    </div>
  )
}

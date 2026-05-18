import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { describe, expect, it } from 'vitest'

import { SubmissionDetail } from './submission-detail'
import type { KycSubmissionDetailRow } from '@/hooks/use-admin-kyc'

const baseDetail: KycSubmissionDetailRow = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tttttttt-tttt-4ttt-8ttt-tttttttttttt',
  submissionType: 'individual',
  tierRequested: 'tier_1',
  status: 'under_review',
  fields: {
    identity: { fullName: 'Mohammad Rahman', dateOfBirth: '1990-05-12', nidNumber: '1234567890' },
    address: {
      addressLine1: '12 Test Road',
      city: 'Dhaka',
      division: 'dhaka',
      postcode: '1212',
    },
    financial: {
      accountType: 'bank',
      accountName: 'Mohammad Rahman',
      accountNumber: '01234567890',
      bankName: 'Test Bank',
      etinNumber: '123456789012',
    },
  },
  documents: {},
  reviewerChecklist: {},
  reviewerNotes: null,
  reviewerId: null,
  decisionReason: null,
  decidedAt: null,
  createdAt: '2026-05-18T00:00:00Z',
  updatedAt: '2026-05-18T00:00:00Z',
  signedDocuments: {},
}

describe('SubmissionDetail (Individual Tier 1)', () => {
  it('renders identity / address / financial sections with helper text', () => {
    render(<SubmissionDetail submission={baseDetail} />)
    expect(screen.getByText('Identity')).toBeInTheDocument()
    expect(screen.getByText('Address')).toBeInTheDocument()
    expect(screen.getByText('Financial')).toBeInTheDocument()
    // "Mohammad Rahman" appears twice (identity.fullName + financial.accountName).
    expect(screen.getAllByText('Mohammad Rahman').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('1234567890')).toBeInTheDocument()
    // Helper text surfaces the reviewer guidance
    expect(
      screen.getByText(/verify against NBR e-TIN portal at etinportal.nbr.gov.bd/i),
    ).toBeInTheDocument()
  })

  it('renders Org Tier A sections with BIN helper text mentioning 2019-11-30', () => {
    const orgDetail: KycSubmissionDetailRow = {
      ...baseDetail,
      submissionType: 'organisation',
      tierRequested: 'org_a',
      fields: {
        org: {
          legalName: 'Test Ltd',
          tradeLicenseNumber: 'TL/12345',
          bin: '0001234567890',
          dateOfIncorporation: '2020-01-15',
        },
        signatory: { fullName: 'Tanvir Hossain', nidNumber: '9876543210' },
        financial: {
          accountType: 'bank',
          accountName: 'Tanvir Hossain',
          accountNumber: '01234567890',
          bankName: 'Test Bank',
          etinNumber: '987654321098',
        },
      },
    }
    render(<SubmissionDetail submission={orgDetail} />)
    expect(screen.getByText('Organisation')).toBeInTheDocument()
    expect(screen.getByText('Test Ltd')).toBeInTheDocument()
    expect(screen.getByText('0001234567890')).toBeInTheDocument()
    expect(screen.getByText(/13 digits per NBR 2019-11-30 amendment/i)).toBeInTheDocument()
  })

  it('a11y: no axe violations', async () => {
    const { container } = render(<SubmissionDetail submission={baseDetail} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

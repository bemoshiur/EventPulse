import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { describe, expect, it } from 'vitest'

import type { LegalDocumentLandingRow } from '@/lib/legal'
import { TrustCenterLandingGrid } from './trust-center-landing-grid'

const rows: LegalDocumentLandingRow[] = [
  {
    slug: 'privacy',
    category: 'legal_contract',
    title: 'Privacy Policy',
    oneLiner: 'How we handle your data.',
    canonicalUrlPath: '/privacy',
    currentVersion: { version: 'v0.1', isDraft: true },
  },
  {
    slug: 'security',
    category: 'trust_artefact',
    title: 'Security & Infrastructure',
    oneLiner: 'Cloud architecture, encryption, KMS.',
    canonicalUrlPath: '/trust/security',
    currentVersion: { version: 'v1.0.0', isDraft: false },
  },
]

describe('TrustCenterLandingGrid', () => {
  it('renders contracts + artefacts sections', () => {
    render(<TrustCenterLandingGrid rows={rows} />)
    expect(screen.getByText(/Legal contracts/i)).toBeInTheDocument()
    expect(screen.getByText(/Trust artefacts/i)).toBeInTheDocument()
  })

  it('renders each document card with its title + one-liner + version', () => {
    render(<TrustCenterLandingGrid rows={rows} />)
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument()
    expect(screen.getByText('Security & Infrastructure')).toBeInTheDocument()
    expect(screen.getByText('How we handle your data.')).toBeInTheDocument()
    expect(screen.getByText(/Version v0\.1/)).toBeInTheDocument()
    expect(screen.getByText(/Version v1\.0\.0/)).toBeInTheDocument()
  })

  it('shows DRAFT badge only on draft documents', () => {
    render(<TrustCenterLandingGrid rows={rows} />)
    expect(screen.getAllByText(/Draft/i)).toHaveLength(1)
  })

  it('cards link to the canonical_url_path', () => {
    render(<TrustCenterLandingGrid rows={rows} />)
    const privacyLink = screen.getByRole('link', { name: /Privacy Policy/i })
    expect(privacyLink).toHaveAttribute('href', '/privacy')
    const securityLink = screen.getByRole('link', { name: /Security & Infrastructure/i })
    expect(securityLink).toHaveAttribute('href', '/trust/security')
  })

  it('is axe-clean', async () => {
    const { container } = render(<TrustCenterLandingGrid rows={rows} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

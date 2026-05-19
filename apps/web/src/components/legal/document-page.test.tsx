import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { describe, expect, it } from 'vitest'

import type { LegalDocumentRender } from '@/lib/legal'
import { LegalDocumentPage } from './document-page'

function buildDoc(
  overrides: Partial<LegalDocumentRender['currentVersion']> = {},
): LegalDocumentRender {
  return {
    slug: 'privacy',
    category: 'legal_contract',
    title: 'Privacy Policy',
    oneLiner: 'How we handle your data.',
    canonicalUrlPath: '/privacy',
    requiresSignature: true,
    currentVersion: {
      version: 'v0.1',
      effectiveAt: '2026-05-19T00:00:00Z',
      bodyHtml: '<h2>Section A</h2><p>Hello world.</p>',
      materialChange: false,
      isDraft: true,
      ...overrides,
    },
  }
}

describe('LegalDocumentPage', () => {
  it('renders the document title', () => {
    render(<LegalDocumentPage doc={buildDoc()} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument()
  })

  it('renders the version metadata line', () => {
    render(<LegalDocumentPage doc={buildDoc()} />)
    expect(screen.getByText(/Version v0\.1/)).toBeInTheDocument()
  })

  it('renders the DRAFT banner when isDraft = true', () => {
    render(<LegalDocumentPage doc={buildDoc({ isDraft: true })} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/Draft · v0\.1/i)).toBeInTheDocument()
  })

  it('does NOT render the DRAFT banner when isDraft = false', () => {
    render(<LegalDocumentPage doc={buildDoc({ isDraft: false, version: 'v1.0.0' })} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the sanitized body_html content', () => {
    render(<LegalDocumentPage doc={buildDoc()} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Section A' })).toBeInTheDocument()
    expect(screen.getByText('Hello world.')).toBeInTheDocument()
  })

  it('breadcrumb links to /trust', () => {
    render(<LegalDocumentPage doc={buildDoc()} />)
    const breadcrumb = screen.getByRole('link', { name: /trust center/i })
    expect(breadcrumb).toHaveAttribute('href', '/trust')
  })

  it('is axe-clean (DRAFT state)', async () => {
    const { container } = render(<LegalDocumentPage doc={buildDoc()} />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('is axe-clean (non-draft state)', async () => {
    const { container } = render(
      <LegalDocumentPage doc={buildDoc({ isDraft: false, version: 'v1.0.0' })} />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { DocumentViewer } from './document-viewer'

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  Wrapper.displayName = 'TestWrapper'
  return Wrapper
}

const documents = {
  nid_front: 's3://eventpulse-kyc-test/tenants/t/x/nid_front.jpg',
  nid_back: 's3://eventpulse-kyc-test/tenants/t/x/nid_back.jpg',
  trade_license: 's3://eventpulse-kyc-test/tenants/t/x/trade_license.pdf',
}

const signedDocuments = {
  nid_front: {
    url: 'https://dry-run.invalid/eventpulse-kyc-test/.../nid_front.jpg?X-Amz-DryRun=1',
    key: 'tenants/t/x/nid_front.jpg',
    expiresIn: 900,
    dryRun: true,
  },
  nid_back: {
    url: 'https://dry-run.invalid/eventpulse-kyc-test/.../nid_back.jpg?X-Amz-DryRun=1',
    key: 'tenants/t/x/nid_back.jpg',
    expiresIn: 900,
    dryRun: true,
  },
  trade_license: {
    url: 'https://dry-run.invalid/eventpulse-kyc-test/.../trade_license.pdf?X-Amz-DryRun=1',
    key: 'tenants/t/x/trade_license.pdf',
    expiresIn: 900,
    dryRun: true,
  },
}

describe('DocumentViewer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders each document with a labelled verified-checkbox', () => {
    render(
      <DocumentViewer
        documents={documents}
        signedDocuments={signedDocuments}
        submissionId="sub-1"
        submissionType="individual"
        checklist={{}}
      />,
      { wrapper: wrapper() },
    )
    expect(screen.getByRole('checkbox', { name: /verified: nid front/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /verified: nid back/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /verified: trade license/i })).toBeInTheDocument()
  })

  it('renders image documents with <img> + alt text and PDF documents as link-out', () => {
    render(
      <DocumentViewer
        documents={documents}
        signedDocuments={signedDocuments}
        submissionId="sub-1"
        submissionType="individual"
        checklist={{}}
      />,
      { wrapper: wrapper() },
    )
    expect(screen.getByAltText(/nid front for this submission/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open pdf in new tab/i })).toHaveAttribute(
      'href',
      expect.stringContaining('trade_license.pdf'),
    )
  })

  it('reflects checked state from the reviewer checklist', () => {
    render(
      <DocumentViewer
        documents={documents}
        signedDocuments={signedDocuments}
        submissionId="sub-1"
        submissionType="individual"
        checklist={{
          nid_front: {
            checked: true,
            checkedAt: new Date().toISOString(),
            checkedBy: 'user-1',
          },
        }}
      />,
      { wrapper: wrapper() },
    )
    expect(screen.getByRole('checkbox', { name: /verified: nid front/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /verified: nid back/i })).not.toBeChecked()
  })

  it('a11y: no axe violations', async () => {
    const { container } = render(
      <DocumentViewer
        documents={documents}
        signedDocuments={signedDocuments}
        submissionId="sub-1"
        submissionType="individual"
        checklist={{}}
      />,
      { wrapper: wrapper() },
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

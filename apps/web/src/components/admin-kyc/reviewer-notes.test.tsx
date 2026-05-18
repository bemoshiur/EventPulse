import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { ReviewerNotes } from './reviewer-notes'

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

describe('ReviewerNotes', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders initial notes value and char counter', () => {
    render(<ReviewerNotes submissionId="x" initialNotes="hello" />, { wrapper: wrapper() })
    const ta = screen.getByRole('textbox', { name: /reviewer notes/i })
    expect((ta as HTMLTextAreaElement).value).toBe('hello')
    expect(screen.getByText(/5 \/ 8000/)).toBeInTheDocument()
  })

  it('does NOT PATCH on blur if notes unchanged', () => {
    const fetchMock = vi.mocked(global.fetch)
    render(<ReviewerNotes submissionId="x" initialNotes="hello" />, { wrapper: wrapper() })
    const ta = screen.getByRole('textbox', { name: /reviewer notes/i })
    fireEvent.blur(ta)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('PATCHes on blur when notes changed; surfaces "Saved" indicator', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'x',
            reviewerNotes: 'changed',
            tenantId: 't',
            submissionType: 'individual',
            tierRequested: 'tier_1',
            status: 'under_review',
            fields: {},
            documents: {},
            reviewerChecklist: {},
            reviewerId: null,
            decisionReason: null,
            decidedAt: null,
            createdAt: '',
            updatedAt: '',
            signedDocuments: {},
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    render(<ReviewerNotes submissionId="x" initialNotes="hello" />, { wrapper: wrapper() })
    const ta = screen.getByRole('textbox', { name: /reviewer notes/i })
    fireEvent.change(ta, { target: { value: 'changed' } })
    fireEvent.blur(ta)
    await waitFor(() => expect(screen.getByText(/^Saved$/)).toBeInTheDocument())
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/admin/kyc/submissions/x/notes'),
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('a11y: no axe violations', async () => {
    const { container } = render(<ReviewerNotes submissionId="x" initialNotes="hello" />, {
      wrapper: wrapper(),
    })
    expect(await axe(container)).toHaveNoViolations()
  })
})

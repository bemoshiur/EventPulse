import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { DecisionActions } from './decision-actions'
import { INDIVIDUAL_TIER_1_REQUIRED_CHECKLIST_KEYS } from '@eventpulse/shared-types'
import type { KycSubmissionDetailRow } from '@/hooks/use-admin-kyc'

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

function makeChecklist(
  reviewerId: string,
  keys: readonly string[],
): KycSubmissionDetailRow['reviewerChecklist'] {
  const out: KycSubmissionDetailRow['reviewerChecklist'] = {}
  for (const k of keys) {
    out[k] = { checked: true, checkedAt: new Date().toISOString(), checkedBy: reviewerId }
  }
  return out
}

describe('DecisionActions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('approve is DISABLED when required checklist keys are missing', () => {
    render(
      <DecisionActions
        submissionId="11111111-1111-4111-8111-111111111111"
        submissionType="individual"
        status="under_review"
        checklist={{}}
      />,
      { wrapper: wrapper() },
    )
    const btn = screen.getByRole('button', { name: 'Approve' })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/checklist item.* unverified/i, { exact: false })).toBeInTheDocument()
  })

  it('approve is ENABLED when all required keys are checked', () => {
    const checklist = makeChecklist('user-1', INDIVIDUAL_TIER_1_REQUIRED_CHECKLIST_KEYS)
    render(
      <DecisionActions
        submissionId="22222222-2222-4222-8222-222222222222"
        submissionType="individual"
        status="under_review"
        checklist={checklist}
      />,
      { wrapper: wrapper() },
    )
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
  })

  it('approve modal requires typed "APPROVE" to enable submit', async () => {
    const checklist = makeChecklist('user-1', INDIVIDUAL_TIER_1_REQUIRED_CHECKLIST_KEYS)
    render(
      <DecisionActions
        submissionId="33333333-3333-4333-8333-333333333333"
        submissionType="individual"
        status="under_review"
        checklist={checklist}
      />,
      { wrapper: wrapper() },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog')
    const modalBtn = within(dialog).getByRole('button', { name: 'Approve' })
    expect(modalBtn).toBeDisabled()
    const input = within(dialog).getByLabelText(/confirmation/i)
    fireEvent.change(input, { target: { value: 'NOT YET' } })
    expect(modalBtn).toBeDisabled()
    fireEvent.change(input, { target: { value: 'APPROVE' } })
    expect(modalBtn).toBeEnabled()
  })

  it('reject modal requires reason min 10 chars to enable submit', async () => {
    render(
      <DecisionActions
        submissionId="44444444-4444-4444-8444-444444444444"
        submissionType="individual"
        status="under_review"
        checklist={{}}
      />,
      { wrapper: wrapper() },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog')
    const modalBtn = within(dialog).getByRole('button', { name: 'Reject' })
    expect(modalBtn).toBeDisabled()
    const ta = within(dialog).getByLabelText(/reason \(10–1000 chars\)/i)
    fireEvent.change(ta, { target: { value: 'too short' } })
    expect(modalBtn).toBeDisabled()
    fireEvent.change(ta, { target: { value: 'NID image is too blurry to read' } })
    expect(modalBtn).toBeEnabled()
  })

  it('both buttons disabled when status is already approved', () => {
    const { container } = render(
      <DecisionActions
        submissionId="55555555-5555-4555-8555-555555555555"
        submissionType="individual"
        status="approved"
        checklist={{}}
      />,
      { wrapper: wrapper() },
    )
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
    expect(container.textContent ?? '').toMatch(/has been\s+approved/i)
  })

  it('surfaces CONFLICT_OF_INTEREST error with reviewer-friendly message', async () => {
    const checklist = makeChecklist('user-1', INDIVIDUAL_TIER_1_REQUIRED_CHECKLIST_KEYS)
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'CONFLICT_OF_INTEREST',
            message:
              'reviewer participated as tenant_user on this submission and cannot approve it',
            request_id: null,
          },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    )

    render(
      <DecisionActions
        submissionId="66666666-6666-4666-8666-666666666666"
        submissionType="individual"
        status="under_review"
        checklist={checklist}
      />,
      { wrapper: wrapper() },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText(/confirmation/i)
    fireEvent.change(input, { target: { value: 'APPROVE' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(
        screen.getByText(/you participated as the tenant on this submission/i),
      ).toBeInTheDocument(),
    )
  })

  it('a11y: no axe violations on the decision actions card', async () => {
    const checklist = makeChecklist('user-1', INDIVIDUAL_TIER_1_REQUIRED_CHECKLIST_KEYS)
    const { container } = render(
      <DecisionActions
        submissionId="77777777-7777-4777-8777-777777777777"
        submissionType="individual"
        status="under_review"
        checklist={checklist}
      />,
      { wrapper: wrapper() },
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

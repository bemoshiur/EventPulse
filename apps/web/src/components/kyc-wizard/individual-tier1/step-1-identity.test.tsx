import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'

import { Step1Identity } from './step-1-identity'

const SUBMISSION = '00000000-0000-4000-8000-000000000001'

describe('<Step1Identity>', () => {
  it('submits valid identity values to onValidSubmit', async () => {
    const user = userEvent.setup()
    const onValidSubmit = vi.fn()
    render(
      <Step1Identity
        submissionId={SUBMISSION}
        formId="test-form"
        uploadedDocs={{}}
        onUploaded={vi.fn()}
        onValidSubmit={onValidSubmit}
      />,
    )

    await user.type(screen.getByLabelText(/full name/i), 'Mohammad Rahman')
    await user.type(screen.getByLabelText(/date of birth/i), '1990-05-12')
    await user.type(screen.getByLabelText(/nid number/i), '1234567890')

    // Submit via the form id (mirrors how the wizard's frame triggers
    // submission — `requestSubmit` on the form element).
    const form = document.getElementById('test-form') as HTMLFormElement
    form.requestSubmit()

    await waitFor(() => expect(onValidSubmit).toHaveBeenCalledTimes(1))
    // react-hook-form passes (values, event) — assert on the first
    // positional arg only since we don't care about the event shape.
    expect(onValidSubmit.mock.calls[0]?.[0]).toMatchObject({
      fullName: 'Mohammad Rahman',
      dateOfBirth: '1990-05-12',
      nidNumber: '1234567890',
    })
  })

  it('rejects an under-18 date of birth with an inline error', async () => {
    const user = userEvent.setup()
    const onValidSubmit = vi.fn()
    render(
      <Step1Identity
        submissionId={SUBMISSION}
        formId="test-form"
        uploadedDocs={{}}
        onUploaded={vi.fn()}
        onValidSubmit={onValidSubmit}
      />,
    )

    await user.type(screen.getByLabelText(/full name/i), 'Underage User')
    await user.type(screen.getByLabelText(/date of birth/i), '2020-01-01')
    await user.type(screen.getByLabelText(/nid number/i), '1234567890')

    const form = document.getElementById('test-form') as HTMLFormElement
    form.requestSubmit()

    await waitFor(() => {
      expect(screen.getByText(/at least 18/i)).toBeInTheDocument()
    })
    expect(onValidSubmit).not.toHaveBeenCalled()
  })

  it('has no axe accessibility violations', async () => {
    const { container } = render(
      <Step1Identity
        submissionId={SUBMISSION}
        formId="test-form"
        uploadedDocs={{}}
        onUploaded={vi.fn()}
        onValidSubmit={vi.fn()}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'

import { Step1OrgInfo } from './step-1-org-info'

describe('<Step1OrgInfo>', () => {
  it('submits valid org info to onValidSubmit', async () => {
    const user = userEvent.setup()
    const onValidSubmit = vi.fn()
    render(<Step1OrgInfo formId="test-form" onValidSubmit={onValidSubmit} />)

    await user.type(screen.getByLabelText(/legal name/i), 'Acme Bangladesh Ltd')
    await user.type(screen.getByLabelText(/trade license number/i), 'TL-2024-DHK-0042')
    await user.type(screen.getByLabelText(/bin/i), '0001234567890')
    await user.type(screen.getByLabelText(/date of incorporation/i), '2018-03-15')

    const form = document.getElementById('test-form') as HTMLFormElement
    form.requestSubmit()

    await waitFor(() => expect(onValidSubmit).toHaveBeenCalledTimes(1))
    expect(onValidSubmit.mock.calls[0]?.[0]).toMatchObject({
      legalName: 'Acme Bangladesh Ltd',
      tradeLicenseNumber: 'TL-2024-DHK-0042',
      bin: '0001234567890',
      dateOfIncorporation: '2018-03-15',
    })
  })

  it('rejects a 9-digit BIN with the NBR format error (BLOCKER regression guard)', async () => {
    const user = userEvent.setup()
    const onValidSubmit = vi.fn()
    render(<Step1OrgInfo formId="test-form" onValidSubmit={onValidSubmit} />)

    await user.type(screen.getByLabelText(/legal name/i), 'Acme BD Ltd')
    await user.type(screen.getByLabelText(/trade license number/i), 'TL-2024-DHK-0042')
    // 9-digit BIN — the deprecated format NBR rejected in 2019-11-30.
    await user.type(screen.getByLabelText(/bin/i), '123456789')
    await user.type(screen.getByLabelText(/date of incorporation/i), '2018-03-15')

    const form = document.getElementById('test-form') as HTMLFormElement
    form.requestSubmit()

    await waitFor(() => {
      expect(screen.getByText(/13 digits/i)).toBeInTheDocument()
    })
    expect(onValidSubmit).not.toHaveBeenCalled()
  })

  it('rejects a future date of incorporation', async () => {
    const user = userEvent.setup()
    const onValidSubmit = vi.fn()
    render(<Step1OrgInfo formId="test-form" onValidSubmit={onValidSubmit} />)

    await user.type(screen.getByLabelText(/legal name/i), 'Future Co')
    await user.type(screen.getByLabelText(/trade license number/i), 'TL-2099')
    await user.type(screen.getByLabelText(/bin/i), '0001234567890')
    await user.type(screen.getByLabelText(/date of incorporation/i), '2099-01-01')

    const form = document.getElementById('test-form') as HTMLFormElement
    form.requestSubmit()

    await waitFor(() => {
      expect(screen.getByText(/must be in the past/i)).toBeInTheDocument()
    })
    expect(onValidSubmit).not.toHaveBeenCalled()
  })

  it('has no axe accessibility violations', async () => {
    const { container } = render(<Step1OrgInfo formId="test-form" onValidSubmit={vi.fn()} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

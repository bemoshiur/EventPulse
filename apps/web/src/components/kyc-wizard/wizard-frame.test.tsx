import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'

import { WizardFrame } from './wizard-frame'

const STEPS = [
  { id: 'identity', label: 'Identity', labelBn: 'পরিচয়' },
  { id: 'address', label: 'Address', labelBn: 'ঠিকানা' },
  { id: 'financial', label: 'Financial', labelBn: 'আর্থিক' },
  { id: 'review', label: 'Review', labelBn: 'যাচাই' },
]

describe('<WizardFrame>', () => {
  it('renders title, current step heading, and progress indicator', () => {
    render(
      <WizardFrame
        title="Verify your identity"
        steps={STEPS}
        currentStepIndex={1}
        primaryLabel="Save & continue"
      >
        <div>step content</div>
      </WizardFrame>,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: /verify your identity/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /step 2: address/i })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /kyc wizard progress/i })).toHaveAttribute(
      'aria-valuenow',
      '2',
    )
  })

  it('disables Back on step 1, enables on step 2+', () => {
    const { rerender } = render(
      <WizardFrame steps={STEPS} currentStepIndex={0} title="t" primaryLabel="next">
        <div>x</div>
      </WizardFrame>,
    )
    expect(screen.getByRole('button', { name: /back to previous step/i })).toBeDisabled()

    rerender(
      <WizardFrame
        steps={STEPS}
        currentStepIndex={1}
        title="t"
        primaryLabel="next"
        onBack={vi.fn()}
      >
        <div>x</div>
      </WizardFrame>,
    )
    expect(screen.getByRole('button', { name: /back to previous step/i })).toBeEnabled()
  })

  it('fires onPrimary when the CTA is clicked', async () => {
    const user = userEvent.setup()
    const onPrimary = vi.fn()
    render(
      <WizardFrame
        steps={STEPS}
        currentStepIndex={0}
        title="t"
        primaryLabel="Save & continue"
        onPrimary={onPrimary}
      >
        <div>x</div>
      </WizardFrame>,
    )
    await user.click(screen.getByRole('button', { name: /save & continue/i }))
    expect(onPrimary).toHaveBeenCalledTimes(1)
  })

  it('renders the "Saving…" label and disables CTA when isPrimaryBusy', () => {
    render(
      <WizardFrame
        steps={STEPS}
        currentStepIndex={0}
        title="t"
        primaryLabel="Save & continue"
        isPrimaryBusy
      >
        <div>x</div>
      </WizardFrame>,
    )
    const btn = screen.getByRole('button', { name: /saving…/i })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })

  it('has no axe accessibility violations', async () => {
    const { container } = render(
      <WizardFrame
        title="Verify your identity"
        titleBn="আপনার পরিচয় যাচাই করুন"
        steps={STEPS}
        currentStepIndex={0}
        primaryLabel="Save & continue"
        primaryLabelBn="সংরক্ষণ ও পরবর্তী"
      >
        <p>Step content</p>
      </WizardFrame>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

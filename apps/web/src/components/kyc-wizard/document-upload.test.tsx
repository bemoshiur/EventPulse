import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'

import { DocumentUpload } from './document-upload'

describe('<DocumentUpload>', () => {
  it('shows the labelled file input in idle state', () => {
    render(
      <DocumentUpload
        submissionId="00000000-0000-4000-8000-000000000001"
        documentType="nid_front"
        label="NID front"
        onUploaded={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/NID front/i)).toBeInTheDocument()
  })

  it('renders the Upload button once a file is selected', async () => {
    const user = userEvent.setup()
    render(
      <DocumentUpload
        submissionId="00000000-0000-4000-8000-000000000001"
        documentType="nid_front"
        label="NID front"
        onUploaded={vi.fn()}
      />,
    )
    const input = screen.getByLabelText(/NID front/i) as HTMLInputElement
    const file = new File(['fake'], 'nid.jpg', { type: 'image/jpeg' })
    await user.upload(input, file)
    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('displays the "Uploaded" check when alreadyUploaded is true', () => {
    render(
      <DocumentUpload
        submissionId="00000000-0000-4000-8000-000000000001"
        documentType="nid_front"
        label="NID front"
        onUploaded={vi.fn()}
        alreadyUploaded
      />,
    )
    expect(screen.getByText(/uploaded/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /replace/i })).toBeInTheDocument()
  })

  it('has no axe accessibility violations in idle state', async () => {
    const { container } = render(
      <DocumentUpload
        submissionId="00000000-0000-4000-8000-000000000001"
        documentType="nid_front"
        label="NID front"
        labelBn="এনআইডির সামনের পাশ"
        hint="JPG, PNG, WebP, or PDF. Max 10 MB."
        onUploaded={vi.fn()}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

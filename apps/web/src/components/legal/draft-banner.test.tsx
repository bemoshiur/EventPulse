import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { describe, expect, it } from 'vitest'

import { DraftBanner } from './draft-banner'

describe('DraftBanner', () => {
  it('renders the version tag + DRAFT eyebrow', () => {
    render(<DraftBanner version="v0.1" />)
    expect(screen.getByText(/Draft · v0\.1/i)).toBeInTheDocument()
  })

  it('communicates no legal effect', () => {
    render(<DraftBanner version="v0.1" />)
    expect(screen.getByText(/No legal effect is intended or implied/i)).toBeInTheDocument()
  })

  it('uses role="alert" for assistive tech (load-bearing — non-dismissable)', () => {
    render(<DraftBanner version="v0.1" />)
    const banner = screen.getByRole('alert')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveAttribute('aria-live', 'polite')
  })

  it('is axe-clean', async () => {
    const { container } = render(<DraftBanner version="v0.1" />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

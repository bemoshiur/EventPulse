import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'

import { AccountTypeModal } from './account-type-modal'

describe('<AccountTypeModal>', () => {
  beforeEach(() => {
    // Default: motion enabled (matchMedia exists in jsdom but reports false
    // for prefers-reduced-motion unless we stub it for that one test below).
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('focuses the first choice card on mount', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<AccountTypeModal isLoading={false} onSubmit={onSubmit} />)

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /individual/i })).toHaveFocus()
    })
  })

  it('submit button is disabled until a choice is made, enabled after', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<AccountTypeModal isLoading={false} onSubmit={onSubmit} />)

    const submit = screen.getByRole('button', { name: /continue/i })
    expect(submit).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: /individual/i }))
    expect(submit).toBeEnabled()
  })

  it('arrow keys cycle between choice cards', async () => {
    const user = userEvent.setup()
    render(<AccountTypeModal isLoading={false} onSubmit={vi.fn()} />)

    const individual = screen.getByRole('radio', { name: /individual/i })
    const organisation = screen.getByRole('radio', { name: /organisation/i })

    await waitFor(() => expect(individual).toHaveFocus())

    await user.keyboard('{ArrowRight}')
    expect(organisation).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(individual).toHaveFocus()

    // Wraparound: ArrowLeft from index 0 → index 1.
    await user.keyboard('{ArrowLeft}')
    expect(organisation).toHaveFocus()
  })

  it('Enter on focused card selects it (mirrors click)', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<AccountTypeModal isLoading={false} onSubmit={onSubmit} />)

    const individual = screen.getByRole('radio', { name: /individual/i })
    await waitFor(() => expect(individual).toHaveFocus())

    await user.keyboard('{Enter}')
    expect(individual).toHaveAttribute('aria-checked', 'true')

    const submit = screen.getByRole('button', { name: /continue/i })
    expect(submit).toBeEnabled()
  })

  it('Space on focused card also selects it', async () => {
    const user = userEvent.setup()
    render(<AccountTypeModal isLoading={false} onSubmit={vi.fn()} />)

    const individual = screen.getByRole('radio', { name: /individual/i })
    await waitFor(() => expect(individual).toHaveFocus())

    await user.keyboard(' ')
    expect(individual).toHaveAttribute('aria-checked', 'true')
  })

  it('Escape is a no-op (modal stays open)', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AccountTypeModal isLoading={false} onSubmit={onSubmit} />)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    await user.keyboard('{Escape}')

    // Modal still in the DOM; onSubmit never called.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('backdrop click does nothing (no close handler attached)', async () => {
    const user = userEvent.setup()
    render(<AccountTypeModal isLoading={false} onSubmit={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    // The backdrop is the role="presentation" outer div; clicking it must not
    // unmount the dialog (no onClick handler bound).
    const backdrop = screen.getByRole('presentation')
    await user.click(backdrop)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('focus trap pulls focus back into the dialog when it escapes', async () => {
    render(
      <>
        <button data-testid="outside-button">Outside</button>
        <AccountTypeModal isLoading={false} onSubmit={vi.fn()} />
      </>,
    )

    // Wait for the modal's on-mount focus to land on the first card.
    await waitFor(() => expect(screen.getByRole('radio', { name: /individual/i })).toHaveFocus())

    // Programmatically try to move focus outside the dialog. The trap's
    // focusin listener should snap it back to the first card.
    const outside = screen.getByTestId('outside-button')
    outside.focus()

    await waitFor(() => expect(screen.getByRole('radio', { name: /individual/i })).toHaveFocus())
  })

  it('submit calls onSubmit with the selected type and shows Saving… state', async () => {
    const user = userEvent.setup()
    let resolveSubmit: () => void = () => undefined
    const onSubmit = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve
        }),
    )
    render(<AccountTypeModal isLoading={false} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('radio', { name: /organisation/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(onSubmit).toHaveBeenCalledWith('organisation')
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()

    resolveSubmit()
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled())
  })

  it('submit failure shows an inline error and re-enables retry', async () => {
    const user = userEvent.setup()
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('Could not save your choice. Please try again.'))
      .mockResolvedValueOnce(undefined)
    render(<AccountTypeModal isLoading={false} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('radio', { name: /individual/i }))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // Inline error visible; submit button re-enabled for retry.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Could not save your choice/i)
    })
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()

    // Retry: succeeds this time.
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
  })

  it('reduced-motion preference collapses Framer Motion entry to instant', () => {
    // Override the default matchMedia stub for this one test to report
    // prefers-reduced-motion: true.
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('reduce'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )

    // No throw + dialog mounts immediately is the assertion: the
    // useReducedMotion hook returns true, the framer-motion transition
    // collapses to duration:0, and the dialog is in the DOM right away.
    render(<AccountTypeModal isLoading={false} onSubmit={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('has no axe accessibility violations', async () => {
    const { container } = render(<AccountTypeModal isLoading={false} onSubmit={vi.fn()} />)
    // Wait for the modal's initial focus to settle so axe sees the
    // post-mount state (focus trap + aria attributes both wired).
    await waitFor(() => expect(screen.getByRole('radio', { name: /individual/i })).toHaveFocus())
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})

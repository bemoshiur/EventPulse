import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TenantTypeGate } from './tenant-type-gate'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('<TenantTypeGate>', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders modal + ghost-of-children while loading (no remount flash)', () => {
    // fetch never resolves — gate stays in loading state.
    vi.mocked(global.fetch).mockReturnValueOnce(new Promise<Response>(() => undefined))

    render(
      <TenantTypeGate>
        <div data-testid="child-content">Dashboard</div>
      </TenantTypeGate>,
    )

    // Children mounted, but visually behind via opacity + pointer-events:none.
    const child = screen.getByTestId('child-content')
    expect(child).toBeInTheDocument()
    expect(child.parentElement).toHaveClass('pointer-events-none')

    // Modal rendered above.
    expect(screen.getByRole('dialog', { name: /choose your account type/i })).toBeInTheDocument()
  })

  it('renders modal when /me returns type: null', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ data: { tenant: { type: null } } }),
    )

    render(
      <TenantTypeGate>
        <div data-testid="child-content">Dashboard</div>
      </TenantTypeGate>,
    )

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /choose your account type/i })).toBeInTheDocument(),
    )
    // Children still mounted underneath (ghost layout).
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })

  it('renders children only (no modal) when /me returns a set type', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ data: { tenant: { type: 'individual' } } }),
    )

    render(
      <TenantTypeGate>
        <div data-testid="child-content">Dashboard</div>
      </TenantTypeGate>,
    )

    // Wait for the fetch to resolve and the gate to transition.
    await waitFor(() => expect(screen.getByTestId('child-content')).toBeInTheDocument())
    // Children NOT inside a pointer-events-none ghost wrapper anymore.
    expect(screen.getByTestId('child-content').parentElement).not.toHaveClass('pointer-events-none')
    // Modal absent.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

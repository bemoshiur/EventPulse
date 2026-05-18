import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TenantTypeGate } from './tenant-type-gate'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

/**
 * Render with a fresh per-test QueryClient. TenantTypeGate uses
 * useTenantType which depends on TanStack Query's context (PR 2 wired
 * the QueryProvider into the tenant portal layout); tests must
 * provide their own client so we don't leak cache between tests.
 */
function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
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

    renderWithQuery(
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

    renderWithQuery(
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

    renderWithQuery(
      <TenantTypeGate>
        <div data-testid="child-content">Dashboard</div>
      </TenantTypeGate>,
    )

    // Wait for the gate to transition out of the loading state —
    // the modal's disappearance is the load-bearing signal, not the
    // child's presence (children mount in both states, just wrapped
    // differently). See `tenant-type-gate.tsx` line 92-101.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Children NOT inside a pointer-events-none ghost wrapper anymore.
    expect(screen.getByTestId('child-content').parentElement).not.toHaveClass('pointer-events-none')
  })
})

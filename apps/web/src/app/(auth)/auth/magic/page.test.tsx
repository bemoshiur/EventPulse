/**
 * Magic-link consume page — browser-auth integration (Day 46, Option B, step 5).
 *
 * Renders under the (auth) gradient-mesh layout. On mount it POSTs the token to
 * the API consume endpoint (credentials:'include' so the API can set the
 * HttpOnly cookie cross-origin), then hard-navigates to the audience home; on
 * failure it shows recoverable copy. Pure redirect/error logic lives in
 * lib/auth-portal (separately unit-tested); this covers the page wiring + a11y.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let search = ''
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}))

import MagicConsumePage from './page'

describe('magic-link consume page', () => {
  const originalFetch = globalThis.fetch
  const originalLocation = window.location

  beforeEach(() => {
    search = ''
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    Object.defineProperty(window, 'location', { value: originalLocation, configurable: true })
    vi.restoreAllMocks()
  })

  it('shows recoverable copy when the link has no token (and is a11y-clean)', async () => {
    search = '' // no token
    const { container } = render(<MagicConsumePage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/missing its token/i)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('on a successful consume it navigates to the audience home', async () => {
    search = 'token=abc123&audience=super-admin'
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { assign, href: '' },
      configurable: true,
      writable: true,
    })
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    }) as unknown as typeof fetch

    render(<MagicConsumePage />)
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/admin/kyc'))
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/magic-link/consume'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('surfaces a 403 (wrong-portal account) as a recoverable error', async () => {
    search = 'token=abc123&audience=super-admin'
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'FORBIDDEN' } }),
    }) as unknown as typeof fetch

    render(<MagicConsumePage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/access/i)
  })
})

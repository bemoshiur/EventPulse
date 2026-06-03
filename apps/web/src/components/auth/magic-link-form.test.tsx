/**
 * MagicLinkForm tests — browser-auth integration (Day 46).
 *
 * Two behaviours pinned: (1) the request goes to the API base (not a relative
 * URL — relative 404s on prod where the API is a separate host), and (2) an
 * optional `audience` prop is forwarded so an admin sign-in can request a
 * super-admin link (server-enforced by #267).
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MagicLinkForm } from './magic-link-form'

const originalFetch = globalThis.fetch

describe('MagicLinkForm', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  async function submit(email: string) {
    await userEvent.type(screen.getByPlaceholderText(/you@/i), email)
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
  }

  it('posts to the magic-link/request endpoint and shows "check your email"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    render(<MagicLinkForm />)
    await submit('a@example.com')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/magic-link/request'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument()
  })

  it('forwards the audience when provided (admin sign-in → super-admin link)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    render(<MagicLinkForm audience="super-admin" />)
    await submit('admin@example.com')
    const body = fetchMock.mock.calls[0]![1]!.body as string
    expect(body).toContain('"audience":"super-admin"')
  })

  it('omits audience when not provided (server defaults attendee)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    render(<MagicLinkForm />)
    await submit('a@example.com')
    const body = fetchMock.mock.calls[0]![1]!.body as string
    expect(body).not.toContain('audience')
  })
})

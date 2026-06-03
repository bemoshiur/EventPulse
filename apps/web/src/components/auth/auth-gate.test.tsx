/**
 * AuthGate — unit tests (jsdom + RTL + vitest-axe).
 *
 *   1. Right audience → renders the protected children.
 *   2. Wrong audience (e.g. attendee at the tenant portal) → redirect to the
 *      wrongAudiencePath (default /sign-in; tenant portal passes /choose-tenant).
 *   3. 401 → redirect to /sign-in.
 *   4. Network error → redirect to /sign-in (fail closed).
 *   5. While checking, the protected children are NOT rendered.
 *
 * fetch is mocked globally; window.location.assign is a spy (jsdom has no nav).
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { axe } from 'vitest-axe'

import { AuthGate } from './auth-gate'

function jsonRes(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const originalLocation = window.location
let assignSpy: Mock

beforeEach(() => {
  assignSpy = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, assign: assignSpy },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AuthGate', () => {
  it('renders children when the session audience matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonRes(200, { data: { audience: 'tenant' } })),
    )
    const { container } = render(
      <AuthGate audience="tenant">
        <div>Protected dashboard</div>
      </AuthGate>,
    )
    expect(await screen.findByText('Protected dashboard')).toBeInTheDocument()
    expect(assignSpy).not.toHaveBeenCalled()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('redirects an authenticated wrong-audience user to wrongAudiencePath', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonRes(200, { data: { audience: 'attendee' } })),
    )
    render(
      <AuthGate audience="tenant" wrongAudiencePath="/choose-tenant">
        <div>Protected dashboard</div>
      </AuthGate>,
    )
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/choose-tenant'))
    expect(screen.queryByText('Protected dashboard')).not.toBeInTheDocument()
  })

  it('redirects to /sign-in on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(401, {})))
    render(
      <AuthGate audience="super-admin">
        <div>Admin shell</div>
      </AuthGate>,
    )
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/sign-in'))
    expect(screen.queryByText('Admin shell')).not.toBeInTheDocument()
  })

  it('fails closed to /sign-in on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    render(
      <AuthGate audience="tenant">
        <div>Protected dashboard</div>
      </AuthGate>,
    )
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/sign-in'))
  })
})

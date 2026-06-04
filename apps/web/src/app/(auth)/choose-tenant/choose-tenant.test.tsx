/**
 * ChooseTenant picker — unit tests (jsdom + RTL + vitest-axe).
 *
 *   1. Lists the caller's tenants from GET /my/contexts.
 *   2. Empty state when the user has no tenants.
 *   3. Selecting a tenant POSTs /my/contexts/switch then navigates to /dashboard.
 *   4. 401 on load → redirect to /sign-in.
 *   5. Accessibility: axe-clean on the rendered list.
 *
 * `fetch` is mocked at the global boundary; `window.location.assign` is
 * replaced with a spy (jsdom doesn't implement navigation).
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'

import { ChooseTenant } from './page'

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const CONTEXTS = [
  {
    id: TENANT_A,
    name: 'Acme Events',
    slug: 'acme',
    type: 'organisation',
    isPersonal: false,
    kycStatus: 'approved',
  },
  {
    id: TENANT_B,
    name: 'My Personal',
    slug: 'me',
    type: 'individual',
    isPersonal: true,
    kycStatus: 'not_submitted',
  },
]

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

describe('ChooseTenant', () => {
  it('lists the caller’s tenants from GET /my/contexts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonRes(200, { data: { contexts: CONTEXTS } })),
    )
    const { container } = render(<ChooseTenant />)

    expect(await screen.findByText('Acme Events')).toBeInTheDocument()
    expect(screen.getByText('My Personal')).toBeInTheDocument()
    expect(screen.getByText(/@acme/)).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('empty state offers "Create your first event" (starts hosting → /events/new)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(200, { data: { contexts: [] } })) // GET load
      .mockResolvedValueOnce(jsonRes(200, { data: { tenantId: TENANT_A, slug: 'me' } })) // POST start
    vi.stubGlobal('fetch', fetchMock)
    render(<ChooseTenant />)

    const cta = await screen.findByRole('button', { name: /create your first event/i })
    await userEvent.click(cta)

    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/events/new'))
    const [url, opts] = fetchMock.mock.calls[1]!
    expect(String(url)).toContain('/api/v1/my/hosting/start')
    expect(opts).toMatchObject({ method: 'POST', credentials: 'include' })
  })

  it('selecting a tenant POSTs the switch then navigates to /dashboard', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(200, { data: { contexts: CONTEXTS } })) // GET load
      .mockResolvedValueOnce(jsonRes(200, { data: { tenantId: TENANT_A } })) // POST switch
    vi.stubGlobal('fetch', fetchMock)

    render(<ChooseTenant />)
    const acme = await screen.findByText('Acme Events')
    await userEvent.click(acme)

    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/dashboard'))
    const [url, opts] = fetchMock.mock.calls[1]!
    expect(String(url)).toContain('/api/v1/my/contexts/switch')
    expect(opts).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(JSON.parse(opts.body as string)).toEqual({ tenantId: TENANT_A })
  })

  it('redirects to /sign-in when the contexts load returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(401, {})))
    render(<ChooseTenant />)
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/sign-in'))
  })
})

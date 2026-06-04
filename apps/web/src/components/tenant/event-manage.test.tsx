import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'

import { EventManage } from './event-manage'

const DRAFT = {
  id: 'e1',
  slug: 'summer-jam',
  status: 'draft',
  title: 'Summer Jam',
  type: 'concert',
  startsAt: '2026-07-01T06:00:00.000Z',
  endsAt: '2026-07-01T10:00:00.000Z',
}
const PUBLISHED = { ...DRAFT, status: 'published' }

function jsonRes(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

describe('EventManage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('draft: shows Publish; publishing POSTs the transition then reveals the share link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(200, { data: { status: 'published' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<EventManage event={DRAFT} tenantSlug="acme" />)

    // draft → not yet shareable
    expect(screen.queryByText(/eventpulse\.com\.bd\/acme\/summer-jam/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /publish/i }))

    await waitFor(() =>
      expect(screen.getByText(/eventpulse\.com\.bd\/acme\/summer-jam/)).toBeInTheDocument(),
    )
    const [url, opts] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/api/v1/tenant/events/e1/transition')
    expect(opts).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(JSON.parse((opts as { body: string }).body)).toEqual({ to: 'published' })
    expect(await axe(container)).toHaveNoViolations()
  })

  it('published: shows the public share link + no Publish button', async () => {
    const { container } = render(<EventManage event={PUBLISHED} tenantSlug="acme" />)
    expect(screen.getByText(/eventpulse\.com\.bd\/acme\/summer-jam/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^publish/i })).not.toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})

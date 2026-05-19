import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { PublishVersionForm } from './publish-form'

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  Wrapper.displayName = 'TestWrapper'
  return Wrapper
}

describe('PublishVersionForm', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows current version + required fields', () => {
    render(<PublishVersionForm slug="privacy" currentVersion="v0.1" onPublished={() => {}} />, {
      wrapper: wrapper(),
    })
    expect(screen.getByText(/Current version is/i)).toBeInTheDocument()
    expect(screen.getByText(/v0\.1/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Version$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Body \(markdown\)$/i)).toBeInTheDocument()
  })

  it('surfaces local validation error when version is empty', async () => {
    const { container } = render(
      <PublishVersionForm slug="privacy" currentVersion="v0.1" onPublished={() => {}} />,
      { wrapper: wrapper() },
    )
    const form = container.querySelector('form')!
    fireEvent.submit(form)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  it('POSTs to the publish endpoint on submit', async () => {
    const fetchMock = vi.mocked(global.fetch)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { versionId: 'new-id' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const onPublished = vi.fn()

    render(<PublishVersionForm slug="privacy" currentVersion="v0.1" onPublished={onPublished} />, {
      wrapper: wrapper(),
    })

    fireEvent.change(screen.getByLabelText(/^Version$/i), { target: { value: 'v0.2' } })
    fireEvent.change(screen.getByLabelText(/^Body \(markdown\)$/i), {
      target: { value: '# Hello\n\nWorld.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Publish version$/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/api/v1/admin/legal/documents/privacy/versions')
    expect(init?.method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string) as {
      version: string
      bodyMd: string
      materialChange?: boolean
    }
    expect(body.version).toBe('v0.2')
    expect(body.bodyMd).toContain('# Hello')

    await waitFor(() => {
      expect(onPublished).toHaveBeenCalled()
    })
  })

  it('shows backend error message on 409', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: 'VERSION_CONFLICT', message: 'version already exists' },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    )

    render(<PublishVersionForm slug="privacy" currentVersion="v0.1" onPublished={() => {}} />, {
      wrapper: wrapper(),
    })
    fireEvent.change(screen.getByLabelText(/^Version$/i), { target: { value: 'v0.1' } })
    fireEvent.change(screen.getByLabelText(/^Body \(markdown\)$/i), { target: { value: '# X' } })
    fireEvent.click(screen.getByRole('button', { name: /^Publish version$/i }))

    await waitFor(() => {
      expect(screen.getByText(/version already exists/i)).toBeInTheDocument()
    })
  })

  it('is axe-clean', async () => {
    const { container } = render(
      <PublishVersionForm slug="privacy" currentVersion="v0.1" onPublished={() => {}} />,
      { wrapper: wrapper() },
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

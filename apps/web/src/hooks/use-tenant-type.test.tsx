import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useInvalidateTenantType, useTenantType } from './use-tenant-type'

/**
 * Per-test QueryClient wrapper. A fresh client per test means no cache
 * leakage between tests; TanStack Query's recommended pattern for hook
 * tests since v5.
 */
function withProvider(): {
  wrapper: ({ children }: { children: ReactNode }) => ReactElement
  client: QueryClient
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { wrapper, client }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('useTenantType', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns type when /me responds with a set tenant type', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ data: { tenant: { type: 'individual' } } }),
    )

    const { wrapper } = withProvider()
    const { result } = renderHook(() => useTenantType(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.type).toBe('individual')
    expect(result.current.error).toBeNull()
  })

  it('returns type: null when /me responds with null type', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ data: { tenant: { type: null } } }),
    )

    const { wrapper } = withProvider()
    const { result } = renderHook(() => useTenantType(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.type).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('surfaces error when /me returns non-ok status', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'AUTH_REQUIRED', message: 'authentication required' } },
        { status: 401 },
      ),
    )

    const { wrapper } = withProvider()
    const { result } = renderHook(() => useTenantType(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).not.toBeNull()
    expect(result.current.error?.message).toContain('AUTH_REQUIRED')
    expect(result.current.type).toBeNull()
  })

  it('starts in isLoading=true before fetch resolves', async () => {
    let resolveFetch: (value: Response) => void = () => undefined
    vi.mocked(global.fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )

    const { wrapper } = withProvider()
    const { result } = renderHook(() => useTenantType(), { wrapper })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.type).toBeNull()

    await act(async () => {
      resolveFetch(jsonResponse({ data: { tenant: { type: 'organisation' } } }))
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.type).toBe('organisation')
  })

  it('refetch re-runs the /me request and updates type', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ data: { tenant: { type: null } } }))
      .mockResolvedValueOnce(jsonResponse({ data: { tenant: { type: 'individual' } } }))

    const { wrapper } = withProvider()
    const { result } = renderHook(() => useTenantType(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.type).toBeNull()

    await act(async () => {
      await result.current.refetch()
    })

    // TanStack Query updates the hook's return value on the next render
    // after the refetch resolves. Wrap in waitFor so React's commit
    // phase has flushed before we assert.
    await waitFor(() => expect(result.current.type).toBe('individual'))
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2)
  })
})

describe('useInvalidateTenantType', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('invalidating the cache causes the next render to refetch', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ data: { tenant: { type: null } } }))
      .mockResolvedValueOnce(jsonResponse({ data: { tenant: { type: 'individual' } } }))

    const { wrapper } = withProvider()
    const { result } = renderHook(
      () => ({
        tenant: useTenantType(),
        invalidate: useInvalidateTenantType(),
      }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.tenant.isLoading).toBe(false))
    expect(result.current.tenant.type).toBeNull()
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1)

    // Mutation-success scenario: the setter just succeeded; the modal
    // wants the gate to re-read tenant type so it can close.
    await act(async () => {
      await result.current.invalidate()
    })

    await waitFor(() => {
      // The second fetch fires because the query is no longer fresh.
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2)
    })
    expect(result.current.tenant.type).toBe('individual')
  })
})

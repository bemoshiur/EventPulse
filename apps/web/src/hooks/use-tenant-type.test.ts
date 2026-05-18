import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTenantType } from './use-tenant-type'

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

    const { result } = renderHook(() => useTenantType())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.type).toBe('individual')
    expect(result.current.error).toBeNull()
  })

  it('returns type: null when /me responds with null type', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ data: { tenant: { type: null } } }),
    )

    const { result } = renderHook(() => useTenantType())

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

    const { result } = renderHook(() => useTenantType())

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

    const { result } = renderHook(() => useTenantType())
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

    const { result } = renderHook(() => useTenantType())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.type).toBeNull()

    await act(async () => {
      await result.current.refetch()
    })

    expect(result.current.type).toBe('individual')
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2)
  })
})

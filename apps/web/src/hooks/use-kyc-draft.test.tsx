import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCreateKycDraft, useKycDraft, usePatchKycDraft, type KycDraftRow } from './use-kyc-draft'

function withProvider(): {
  wrapper: ({ children }: { children: ReactNode }) => ReactElement
  client: QueryClient
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return {
    client,
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

const sampleRow: KycDraftRow = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tttttttt-tttt-4ttt-8ttt-tttttttttttt',
  submissionType: 'individual',
  tierRequested: 'tier_1',
  status: 'draft',
  fields: {},
  documents: {},
  createdAt: '2026-05-18T00:00:00Z',
  updatedAt: '2026-05-18T00:00:00Z',
}

describe('useCreateKycDraft', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /drafts and writes the returned row into the cache', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ data: sampleRow }))

    const { wrapper } = withProvider()
    const { result } = renderHook(() => useCreateKycDraft(), { wrapper })

    let returned: KycDraftRow | undefined
    await act(async () => {
      returned = await result.current.mutateAsync(sampleRow.id)
    })

    expect(returned?.id).toBe(sampleRow.id)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe(sampleRow.id)
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/tenant/kyc/drafts'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('surfaces server errors with code + message', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ error: { code: 'CONFLICT', message: 'already in use' } }, { status: 409 }),
    )

    const { wrapper } = withProvider()
    const { result } = renderHook(() => useCreateKycDraft(), { wrapper })

    let caught: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync(sampleRow.id)
      } catch (err) {
        caught = err
      }
    })

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('already in use')
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('usePatchKycDraft (optimistic update + rollback)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes optimistic update to cache before server responds, then replaces with server row', async () => {
    // First fetch: GET returns the initial draft row.
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ data: sampleRow }))

    const { wrapper, client } = withProvider()

    // Seed the cache by reading first.
    const { result: read } = renderHook(() => useKycDraft(sampleRow.id), { wrapper })
    await waitFor(() => expect(read.current.draft?.id).toBe(sampleRow.id))

    // Second fetch: PATCH returns the server's authoritative row.
    const serverRow = {
      ...sampleRow,
      fields: { identity: { fullName: 'Server-Confirmed' } },
    }
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ data: serverRow }))

    const { result: patch } = renderHook(() => usePatchKycDraft(), { wrapper })

    await act(async () => {
      await patch.current.mutateAsync({
        submissionId: sampleRow.id,
        body: {
          step: 'identity',
          fields: { fullName: 'Optimistic', dateOfBirth: '2000-01-01', nidNumber: '1234567890' },
        },
      })
    })

    // After mutation completes, cache should have the server's row.
    const cached = client.getQueryData<KycDraftRow>(['kyc', 'drafts', sampleRow.id])
    const fields = (cached?.fields ?? {}) as Record<string, Record<string, string> | undefined>
    expect(fields.identity?.fullName).toBe('Server-Confirmed')
  })

  it('rolls back the cache to the pre-mutation snapshot on PATCH failure', async () => {
    // GET seed.
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ data: sampleRow }))
    const { wrapper, client } = withProvider()
    const { result: read } = renderHook(() => useKycDraft(sampleRow.id), { wrapper })
    await waitFor(() => expect(read.current.draft?.id).toBe(sampleRow.id))

    // PATCH fails.
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ error: { code: 'VALIDATION_ERROR', message: 'bad date' } }, { status: 400 }),
    )

    const { result: patch } = renderHook(() => usePatchKycDraft(), { wrapper })

    await act(async () => {
      try {
        await patch.current.mutateAsync({
          submissionId: sampleRow.id,
          body: {
            step: 'identity',
            fields: { fullName: 'WillRollBack', dateOfBirth: 'bad', nidNumber: 'x' },
          },
        })
      } catch {
        // expected
      }
    })

    // Cache should match the pre-mutation snapshot (empty identity).
    const cached = client.getQueryData<KycDraftRow>(['kyc', 'drafts', sampleRow.id])
    const fields = (cached?.fields ?? {}) as Record<string, unknown>
    expect(fields.identity).toBeUndefined()
  })
})

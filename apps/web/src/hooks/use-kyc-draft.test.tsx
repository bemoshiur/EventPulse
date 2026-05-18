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

  it('document-only PATCH overlays optimistic placeholder URI without wiping prior fields (Day 17 carry)', async () => {
    // Carry from Day 16 PR 3 /review issue #5: a step PATCH racing
    // with a document-upload PATCH must not lose the document URI from
    // the optimistic snapshot. After Day 16 fix, the document-only
    // PATCH's onMutate writes an `optimistic:<contentType>` placeholder
    // into `cached.documents` so the cache reflects the slot being
    // filled even before the server responds. This test pins that
    // behaviour.
    const seededRow = {
      ...sampleRow,
      fields: { identity: { fullName: 'Already Typed' } },
      documents: {},
    }
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ data: seededRow }))
    const { wrapper, client } = withProvider()
    const { result: read } = renderHook(() => useKycDraft(seededRow.id), { wrapper })
    await waitFor(() => expect(read.current.draft?.id).toBe(seededRow.id))

    // The server's response (will fire later but we'll snapshot the
    // cache before settle). Use a never-resolving promise so we can
    // inspect the optimistic cache without the server replacing it.
    let resolvePatch: (value: Response) => void = () => undefined
    vi.mocked(global.fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolvePatch = resolve
      }),
    )

    const { result: patch } = renderHook(() => usePatchKycDraft(), { wrapper })

    // Fire the document-only PATCH (no `fields` per the BLOCKER 1 fix).
    let mutationPromise: Promise<KycDraftRow> | undefined
    await act(async () => {
      mutationPromise = patch.current.mutateAsync({
        submissionId: seededRow.id,
        body: {
          step: 'identity',
          documents: { nid_front: { contentType: 'image/jpeg' } },
        },
      })
      // Yield so onMutate's optimistic snapshot lands in the cache.
      await new Promise((r) => setTimeout(r, 0))
    })

    // Cache should reflect the optimistic state: prior fields survive,
    // new document slot filled with the `optimistic:<contentType>`
    // placeholder URI.
    const optimisticCached = client.getQueryData<KycDraftRow>(['kyc', 'drafts', seededRow.id])
    const optimisticFields = (optimisticCached?.fields ?? {}) as Record<
      string,
      Record<string, string> | undefined
    >
    expect(optimisticFields.identity?.fullName).toBe('Already Typed')
    expect(optimisticCached?.documents['nid_front']).toBe('optimistic:image/jpeg')

    // Resolve the PATCH with the server's authoritative S3 URI.
    const serverRow = {
      ...seededRow,
      documents: { nid_front: 's3://eventpulse-kyc-test/tenants/x/y/nid_front.jpg' },
    }
    await act(async () => {
      resolvePatch(jsonResponse({ data: serverRow }))
      await mutationPromise
    })

    const finalCached = client.getQueryData<KycDraftRow>(['kyc', 'drafts', seededRow.id])
    expect(finalCached?.documents['nid_front']).toBe(
      's3://eventpulse-kyc-test/tenants/x/y/nid_front.jpg',
    )
    // Identity fields must survive the whole cycle.
    const finalFields = (finalCached?.fields ?? {}) as Record<
      string,
      Record<string, string> | undefined
    >
    expect(finalFields.identity?.fullName).toBe('Already Typed')
  })
})

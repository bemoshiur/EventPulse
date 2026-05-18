'use client'

/**
 * useKycDraft — TanStack Query hook for KYC draft submissions.
 *
 * Sprint 2 Day 16 Item 12 PR 3. Backs the wizard's resumable draft
 * flow: create on entry → PATCH per step → submit on review. All
 * three mutations go through TanStack Query so the wizard gets
 * optimistic updates + automatic cache invalidation + per-mutation
 * loading/error state for free.
 *
 * Endpoints:
 *   POST   /api/v1/tenant/kyc/drafts
 *   GET    /api/v1/tenant/kyc/drafts/:id
 *   PATCH  /api/v1/tenant/kyc/drafts/:id
 *   POST   /api/v1/tenant/kyc/drafts/:id/submit
 *
 * Optimistic update on PATCH:
 *   - Before the request fires, the cached draft is mutated locally
 *     so the UI reflects the change instantly.
 *   - On success, the server's response replaces the cached row.
 *   - On failure, the pre-mutation snapshot rolls back the cache and
 *     the error surfaces to the caller for retry UI.
 *
 * Document references are stored as S3 URIs by the backend, but the
 * PATCH body only carries the document-type → contentType declaration.
 * The hook's caller (DocumentUpload component) issues the PUT to S3
 * via the Day 13 upload-url endpoint, then includes the slot in the
 * PATCH body so the server materialises the URI server-side.
 *
 * No client-side persistence: PII never enters localStorage / IndexedDB.
 * TanStack Query's cache is in-memory only (no `persistQueryClient`
 * configured); the wizard's react-hook-form instances also stay in
 * memory only. Verified per Day 16 /review checklist in PR 3.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface KycDraftRow {
  id: string
  tenantId: string
  submissionType: 'individual' | 'organisation'
  tierRequested: string
  status: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected'
  fields: Record<string, unknown>
  documents: Record<string, string>
  createdAt: string
  updatedAt: string
}

interface DraftResponse {
  data: KycDraftRow
}

interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    let code = `HTTP_${res.status}`
    let details: unknown
    try {
      const body = (await res.json()) as ApiErrorBody
      if (body.error?.message) message = body.error.message
      if (body.error?.code) code = body.error.code
      details = body.error?.details
    } catch {
      // not JSON — keep status-based message
    }
    const err = new Error(message) as Error & { code?: string; details?: unknown }
    err.code = code
    err.details = details
    throw err
  }
  return (await res.json()) as T
}

// ─── query keys ──────────────────────────────────────────────────────

export const kycDraftQueryKey = (submissionId: string) => ['kyc', 'drafts', submissionId] as const

// ─── GET /:id ────────────────────────────────────────────────────────

async function fetchDraft(submissionId: string): Promise<KycDraftRow> {
  const res = await fetch(`${apiBase()}/api/v1/tenant/kyc/drafts/${submissionId}`, {
    method: 'GET',
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  const body = await jsonOrThrow<DraftResponse>(res)
  return body.data
}

/**
 * Read a draft by id. Returns `{ draft, isLoading, error, refetch }`.
 *
 * Pass `enabled: false` (via the `enabled` arg) when the wizard hasn't
 * created the draft yet — avoids a 404 on first mount.
 */
export function useKycDraft(submissionId: string | null, enabled = true) {
  const query = useQuery({
    queryKey: submissionId ? kycDraftQueryKey(submissionId) : ['kyc', 'drafts', 'null'],
    queryFn: () => fetchDraft(submissionId!),
    enabled: enabled && !!submissionId,
  })
  return {
    draft: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: async () => {
      await query.refetch()
    },
  }
}

// ─── POST / (create draft) ───────────────────────────────────────────

async function createDraftRequest(submissionId: string): Promise<KycDraftRow> {
  const res = await fetch(`${apiBase()}/api/v1/tenant/kyc/drafts`, {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ submissionId }),
  })
  const body = await jsonOrThrow<DraftResponse>(res)
  return body.data
}

export function useCreateKycDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (submissionId: string) => createDraftRequest(submissionId),
    onSuccess: (row) => {
      queryClient.setQueryData(kycDraftQueryKey(row.id), row)
    },
  })
}

// ─── PATCH /:id (per-step update) ────────────────────────────────────

export interface KycDraftPatchInput {
  submissionId: string
  /** Per-step PATCH body — must match IndividualTier1PatchSchema. */
  body: {
    step: 'identity' | 'address' | 'financial'
    fields: Record<string, unknown>
    documents?: Record<string, { contentType: string }>
  }
}

async function patchDraftRequest(input: KycDraftPatchInput): Promise<KycDraftRow> {
  const res = await fetch(`${apiBase()}/api/v1/tenant/kyc/drafts/${input.submissionId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(input.body),
  })
  const body = await jsonOrThrow<DraftResponse>(res)
  return body.data
}

/**
 * PATCH a single step's data. Optimistic update: the cached row's
 * `fields[step]` is replaced locally before the request fires, so the
 * wizard's read of the cache reflects the change instantly. Rollback
 * on failure restores the pre-mutation snapshot.
 */
export function usePatchKycDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: patchDraftRequest,
    onMutate: async (input) => {
      const key = kycDraftQueryKey(input.submissionId)
      // Cancel any outstanding refetch for this key so it doesn't
      // overwrite our optimistic snapshot.
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<KycDraftRow>(key)
      if (previous) {
        const optimistic: KycDraftRow = {
          ...previous,
          fields: {
            ...previous.fields,
            [input.body.step]: input.body.fields,
          },
          updatedAt: new Date().toISOString(),
        }
        queryClient.setQueryData(key, optimistic)
      }
      return { previous }
    },
    onError: (_err, input, ctx) => {
      // Roll back to the pre-mutation snapshot.
      if (ctx?.previous) {
        queryClient.setQueryData(kycDraftQueryKey(input.submissionId), ctx.previous)
      }
    },
    onSuccess: (row) => {
      // Replace with the server's authoritative row (includes
      // materialised document URIs the server derived).
      queryClient.setQueryData(kycDraftQueryKey(row.id), row)
    },
  })
}

// ─── POST /:id/submit ────────────────────────────────────────────────

async function submitDraftRequest(submissionId: string): Promise<KycDraftRow> {
  const res = await fetch(`${apiBase()}/api/v1/tenant/kyc/drafts/${submissionId}/submit`, {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  const body = await jsonOrThrow<DraftResponse>(res)
  return body.data
}

export function useSubmitKycDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (submissionId: string) => submitDraftRequest(submissionId),
    onSuccess: (row) => {
      // Replace the cache with the now-submitted row so the wizard's
      // read sees status='submitted' immediately.
      queryClient.setQueryData(kycDraftQueryKey(row.id), row)
    },
  })
}

// ─── upload-url helper (server returns presigned PUT URL) ────────────

export interface KycUploadUrlInput {
  submissionId: string
  documentType: string
  contentType: string
}

export interface KycUploadUrlResult {
  uploadUrl: string
  key: string
  expiresIn: number
  requiredHeaders: Record<string, string>
  dryRun: boolean
}

/**
 * Request a signed PUT URL from the server, then upload the file to
 * S3 directly. Returns the document declaration the wizard PATCH body
 * needs (`{ contentType }`) so the next PATCH can register the slot.
 *
 * Errors surface via TanStack's mutation state; the wizard renders a
 * retry button. No silent retry — partial uploads on slow BD mobile
 * connections benefit from explicit user control.
 */
async function requestUploadUrl(input: KycUploadUrlInput): Promise<KycUploadUrlResult> {
  const res = await fetch(`${apiBase()}/api/v1/tenant/kyc/upload-url`, {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return jsonOrThrow<{ data: KycUploadUrlResult }>(res).then((b) => b.data)
}

async function uploadToS3(
  url: KycUploadUrlResult,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  // XMLHttpRequest because the fetch API doesn't expose upload progress.
  // Reasonable trade-off — the API surface is small here and the
  // progress UX is meaningfully better on slow connections.
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url.uploadUrl)
    for (const [k, v] of Object.entries(url.requiredHeaders)) {
      xhr.setRequestHeader(k, v)
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`S3 PUT failed: HTTP ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('S3 PUT network error'))
    xhr.onabort = () => reject(new Error('S3 PUT aborted'))
    xhr.send(file)
  })
}

export interface UploadKycDocumentInput {
  submissionId: string
  documentType: string
  file: File
  onProgress?: (percent: number) => void
}

export interface UploadKycDocumentResult {
  contentType: string
  /** The server-derived S3 key (also computable from inputs; surfaced for debugging). */
  key: string
}

/**
 * End-to-end document upload: request signed URL → PUT to S3 → return
 * the slot declaration the wizard needs to include in its next PATCH.
 *
 * This function does NOT issue the PATCH — that's the caller's
 * responsibility (the wizard collects all step uploads then PATCHes
 * with the full step's data once the user clicks "Save & Continue").
 */
export async function uploadKycDocument(
  input: UploadKycDocumentInput,
): Promise<UploadKycDocumentResult> {
  const signed = await requestUploadUrl({
    submissionId: input.submissionId,
    documentType: input.documentType,
    contentType: input.file.type,
  })
  await uploadToS3(signed, input.file, input.onProgress)
  return { contentType: input.file.type, key: signed.key }
}

'use client'

/**
 * useAdminKyc — TanStack Query hooks for the super admin KYC review
 * queue (Sprint 2 Day 18 Item 13 PR 4 — frontend).
 *
 * Five backed endpoints:
 *   GET    /api/v1/admin/kyc/submissions
 *   GET    /api/v1/admin/kyc/submissions/:id           (Decision G, H)
 *   PATCH  /api/v1/admin/kyc/submissions/:id/checklist (Decision I)
 *   PATCH  /api/v1/admin/kyc/submissions/:id/notes     (Decision I)
 *   POST   /api/v1/admin/kyc/submissions/:id/decide    (Decision I)
 *
 * Decision H — no client-side caching of PII fields beyond the
 * current detail view. The detail-view hook OVERRIDES the project's
 * default TanStack Query settings to:
 *   staleTime: 0
 *   gcTime: 0
 *   refetchOnWindowFocus: false
 *   refetchOnReconnect: false
 * When the reviewer navigates away, PII evaporates from client state
 * immediately. List view keeps default caching (no PII).
 *
 * Decision G audit note — mutations DO NOT all share the same audit
 * behaviour. Be precise here:
 *
 *   useDecideSubmission   → invalidateQueries on success → detail
 *                           re-fetch → server writes a SECOND audit
 *                           row (a kyc_submission.viewed for the
 *                           post-decision read). By design — the
 *                           decision is the most important moment to
 *                           re-affirm "the reviewer looked at this
 *                           after deciding."
 *
 *   useToggleChecklistItem → setQueryData on success (NO re-fetch,
 *                           NO second GET audit row). The server
 *                           writes a kyc_submission.checklist_toggled
 *                           audit row during the PATCH itself; the
 *                           PATCH response is the canonical row.
 *
 *   useUpdateReviewerNotes → setQueryData on success (NO re-fetch,
 *                           NO second GET audit row). Server writes a
 *                           kyc_submission.notes_updated audit row
 *                           during the PATCH itself.
 *
 * The asymmetric calibration is intentional: toggles + notes are
 * frequent (one PATCH per click); one audit row per PATCH is the
 * right granularity. Decisions are rare; the extra view-after-decide
 * audit row strengthens the regulator-facing trail.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  ReviewerChecklistTogglePatch,
  ReviewerDecision,
  ReviewerNotesPatch,
} from '@eventpulse/shared-types'

// ─── shared API helpers ────────────────────────────────────────────────

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
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
      /* not JSON */
    }
    const err = new Error(message) as Error & { code?: string; details?: unknown }
    err.code = code
    err.details = details
    throw err
  }
  return (await res.json()) as T
}

/**
 * Read the super-admin access token. For MVP this lives in a cookie
 * set by the auth flow; the fetch helper relies on browser cookie
 * propagation (credentials: 'include'). When the admin portal lands
 * its own auth flow, this helper centralises the lookup.
 */
function fetchWithCreds(input: RequestInfo, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: 'include' })
}

// ─── types ────────────────────────────────────────────────────────────

export interface KycSubmissionListRow {
  id: string
  tenantId: string
  tenantName: string
  tenantSlug: string
  submissionType: 'individual' | 'organisation'
  tierRequested: string
  status: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected'
  submittedAt: string
  updatedAt: string
  checkedKeyCount: number
}

export interface KycSubmissionDetailRow {
  id: string
  tenantId: string
  submissionType: 'individual' | 'organisation'
  tierRequested: string
  status: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected'
  fields: Record<string, unknown>
  documents: Record<string, string>
  reviewerChecklist: Record<
    string,
    { checked: boolean; checkedAt: string; checkedBy: string } | undefined
  >
  reviewerNotes: string | null
  reviewerId: string | null
  decisionReason: string | null
  decidedAt: string | null
  createdAt: string
  updatedAt: string
  signedDocuments: Record<string, { url: string; key: string; expiresIn: number; dryRun: boolean }>
}

export interface ListEnvelope {
  data: KycSubmissionListRow[]
  meta: { nextCursor: string | null; hasMore: boolean }
}

interface DetailEnvelope {
  data: KycSubmissionDetailRow
}

// ─── query keys ────────────────────────────────────────────────────────

export const adminKycKeys = {
  all: ['admin', 'kyc'] as const,
  list: (filter?: { status?: string; tier?: string; cursor?: string }) =>
    [...adminKycKeys.all, 'list', filter ?? {}] as const,
  detail: (id: string) => [...adminKycKeys.all, 'submissions', id, 'detail'] as const,
}

// ─── list view (default caching — lower sensitivity) ───────────────────

export function useAdminKycList(filter?: { status?: string; tier?: string; cursor?: string }) {
  return useQuery({
    queryKey: adminKycKeys.list(filter),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filter?.status) params.set('status', filter.status)
      if (filter?.tier) params.set('tier', filter.tier)
      if (filter?.cursor) params.set('cursor', filter.cursor)
      const qs = params.toString()
      const url = `${apiBase()}/api/v1/admin/kyc/submissions${qs ? `?${qs}` : ''}`
      const res = await fetchWithCreds(url)
      return jsonOrThrow<ListEnvelope>(res)
    },
  })
}

// ─── detail view (Decision H cache override) ───────────────────────────

export function useAdminKycDetail(id: string | null) {
  return useQuery({
    queryKey: id ? adminKycKeys.detail(id) : ['admin', 'kyc', 'detail', 'noop'],
    enabled: id !== null,
    queryFn: async () => {
      if (!id) throw new Error('detail query fired without id')
      const url = `${apiBase()}/api/v1/admin/kyc/submissions/${id}`
      const res = await fetchWithCreds(url)
      const body = await jsonOrThrow<DetailEnvelope>(res)
      return body.data
    },
    // Decision H — PII evaporates on navigation away.
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

// ─── mutations ────────────────────────────────────────────────────────

export function useToggleChecklistItem(submissionId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: ReviewerChecklistTogglePatch): Promise<KycSubmissionDetailRow> => {
      const res = await fetchWithCreds(
        `${apiBase()}/api/v1/admin/kyc/submissions/${submissionId}/checklist`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        },
      )
      const body = await jsonOrThrow<DetailEnvelope>(res)
      return body.data
    },
    onSuccess: (row) => {
      qc.setQueryData(adminKycKeys.detail(submissionId), row)
    },
  })
}

export function useUpdateReviewerNotes(submissionId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: ReviewerNotesPatch): Promise<KycSubmissionDetailRow> => {
      const res = await fetchWithCreds(
        `${apiBase()}/api/v1/admin/kyc/submissions/${submissionId}/notes`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        },
      )
      const body = await jsonOrThrow<DetailEnvelope>(res)
      return body.data
    },
    onSuccess: (row) => {
      qc.setQueryData(adminKycKeys.detail(submissionId), row)
    },
  })
}

export function useDecideSubmission(submissionId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (decision: ReviewerDecision): Promise<KycSubmissionDetailRow> => {
      const res = await fetchWithCreds(
        `${apiBase()}/api/v1/admin/kyc/submissions/${submissionId}/decide`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(decision),
        },
      )
      const body = await jsonOrThrow<DetailEnvelope>(res)
      return body.data
    },
    onSuccess: (row) => {
      qc.setQueryData(adminKycKeys.detail(submissionId), row)
      // Invalidate the list so the queue re-fetches with the new status.
      void qc.invalidateQueries({ queryKey: adminKycKeys.all })
    },
  })
}

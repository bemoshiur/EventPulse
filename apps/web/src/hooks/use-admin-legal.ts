'use client'

/**
 * TanStack Query hooks for the super admin Legal & Trust editor —
 * Sprint 2 Day 19 Item 15.
 *
 * Four backed endpoints:
 *   GET    /api/v1/admin/legal/documents
 *   GET    /api/v1/admin/legal/documents/:slug
 *   GET    /api/v1/admin/legal/documents/:slug/versions/:versionId
 *   POST   /api/v1/admin/legal/documents/:slug/versions
 *
 * No PII surface — these are platform-global legal documents. Default
 * TanStack cache settings apply (staleTime: 30s, gcTime: 5min).
 *
 * On successful publish: invalidate the doc detail + list queries so
 * the editor reflects the new current_version_id immediately. The
 * server fires its own Next.js revalidation hook for the public page;
 * the editor doesn't need to coordinate with that.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

function apiBase(): string {
  const raw = process.env['NEXT_PUBLIC_API_BASE_URL']
  return raw && raw.length > 0 ? raw.replace(/\/$/, '') : ''
}

interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    let code = `HTTP_${res.status}`
    try {
      const body = (await res.json()) as ApiErrorBody
      if (body.error?.message) message = body.error.message
      if (body.error?.code) code = body.error.code
    } catch {
      /* not JSON */
    }
    const err = new Error(message) as Error & { code?: string }
    err.code = code
    throw err
  }
  return (await res.json()) as T
}

function fetchWithCreds(input: RequestInfo, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: 'include' })
}

// ─── types ────────────────────────────────────────────────────────────

export interface AdminLegalDocumentRow {
  slug: string
  category: 'legal_contract' | 'trust_artefact'
  title: string
  oneLiner: string
  canonicalUrlPath: string
  currentVersion: { version: string; isDraft: boolean }
  hasCurrentVersion: boolean
}

export interface AdminLegalDocumentDetail {
  slug: string
  category: 'legal_contract' | 'trust_artefact'
  title: string
  oneLiner: string
  canonicalUrlPath: string
  requiresSignature: boolean
  currentVersion: {
    version: string
    effectiveAt: string
    bodyHtml: string
    materialChange: boolean
    isDraft: boolean
  }
}

export interface AdminLegalVersionSummary {
  id: string
  version: string
  effectiveAt: string
  materialChange: boolean
  summaryOfChanges: string | null
  createdBy: string | null
  createdAt: string
  isCurrent: boolean
}

export interface AdminLegalVersionFull {
  id: string
  documentId: string
  version: string
  bodyMd: string
  bodyHtml: string
  effectiveAt: string
  summaryOfChanges: string | null
  materialChange: boolean
  createdBy: string | null
  createdAt: string
}

// ─── query keys ───────────────────────────────────────────────────────

export const adminLegalKeys = {
  all: ['admin', 'legal'] as const,
  list: () => [...adminLegalKeys.all, 'list'] as const,
  detail: (slug: string) => [...adminLegalKeys.all, 'docs', slug] as const,
  version: (slug: string, versionId: string) =>
    [...adminLegalKeys.all, 'docs', slug, 'versions', versionId] as const,
}

// ─── queries ──────────────────────────────────────────────────────────

export function useAdminLegalList() {
  return useQuery({
    queryKey: adminLegalKeys.list(),
    queryFn: async () => {
      const res = await fetchWithCreds(`${apiBase()}/api/v1/admin/legal/documents`)
      const body = await jsonOrThrow<{ data: AdminLegalDocumentRow[] }>(res)
      return body.data
    },
  })
}

export function useAdminLegalDetail(slug: string | null) {
  return useQuery({
    queryKey: slug ? adminLegalKeys.detail(slug) : ['admin', 'legal', 'detail', 'noop'],
    enabled: slug !== null,
    queryFn: async () => {
      if (!slug) throw new Error('detail query fired without slug')
      const res = await fetchWithCreds(`${apiBase()}/api/v1/admin/legal/documents/${slug}`)
      const body = await jsonOrThrow<{
        data: { document: AdminLegalDocumentDetail; versions: AdminLegalVersionSummary[] }
      }>(res)
      return body.data
    },
  })
}

export function useAdminLegalVersion(slug: string | null, versionId: string | null) {
  return useQuery({
    queryKey:
      slug && versionId
        ? adminLegalKeys.version(slug, versionId)
        : ['admin', 'legal', 'version', 'noop'],
    enabled: slug !== null && versionId !== null,
    queryFn: async () => {
      if (!slug || !versionId) throw new Error('version query fired without slug/versionId')
      const res = await fetchWithCreds(
        `${apiBase()}/api/v1/admin/legal/documents/${slug}/versions/${versionId}`,
      )
      const body = await jsonOrThrow<{ data: AdminLegalVersionFull }>(res)
      return body.data
    },
  })
}

// ─── mutations ────────────────────────────────────────────────────────

export interface PublishVersionInput {
  version: string
  bodyMd: string
  effectiveAt?: string
  summaryOfChanges?: string
  materialChange?: boolean
}

export function usePublishVersion(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: PublishVersionInput): Promise<{ versionId: string }> => {
      const res = await fetchWithCreds(
        `${apiBase()}/api/v1/admin/legal/documents/${slug}/versions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
      )
      const body = await jsonOrThrow<{ data: { versionId: string } }>(res)
      return body.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminLegalKeys.detail(slug) })
      void qc.invalidateQueries({ queryKey: adminLegalKeys.list() })
    },
  })
}

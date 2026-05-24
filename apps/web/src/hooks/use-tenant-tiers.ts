'use client'

/**
 * useTenantTiers — TanStack Query hooks for the tenant ticket-tier
 * CRUD surface (Sprint 3 Day 25).
 *
 * Backed endpoints (all tenant auth):
 *   GET    /api/v1/tenant/events/:eventId/tickets           — list (active)
 *   GET    /api/v1/tenant/events/:eventId/tickets?includeArchived=true
 *   POST   /api/v1/tenant/events/:eventId/tickets           — create
 *   PATCH  /api/v1/tenant/events/:eventId/tickets/:tierId   — update
 *   POST   /api/v1/tenant/events/:eventId/tickets/:tierId/archive
 *
 * Cache: default project TanStack Query settings (staleTime 30s). No
 * PII at this surface. Mutation success invalidates the list query
 * (and any specific tier detail) so the UI reflects the new state.
 *
 * Price is on the wire as a string (paisa-as-string) and parsed back
 * to bigint by callers per §1.3 R2.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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

// ─── types (wire shapes; pricePaisa as string) ────────────────────────

export interface TierWire {
  id: string
  tenantId: string
  eventId: string
  name: string
  description: string | null
  pricePaisa: string
  capacity: number
  sold: number
  salesStartAt: string | null
  salesEndAt: string | null
  minPerOrder: number
  maxPerOrder: number
  isComplimentary: boolean
  sortOrder: number
  archivedAt: string | null
  createdAt: string
}

export interface CreateTierPayload {
  name: string
  description?: string | null
  pricePaisa: string | number
  capacity: number
  salesStartAt?: string | null
  salesEndAt?: string | null
  minPerOrder?: number
  maxPerOrder?: number
  isComplimentary?: boolean
  sortOrder?: number
}

export interface UpdateTierPayload {
  name?: string
  description?: string | null
  pricePaisa?: string | number
  capacity?: number
  salesStartAt?: string | null
  salesEndAt?: string | null
  minPerOrder?: number
  maxPerOrder?: number
  isComplimentary?: boolean
  sortOrder?: number
}

// ─── queries ──────────────────────────────────────────────────────────

export function useTenantTiers(eventId: string | undefined, includeArchived = false) {
  return useQuery({
    queryKey: ['tenant-tiers', eventId, { includeArchived }] as const,
    enabled: Boolean(eventId),
    queryFn: async () => {
      const qs = includeArchived ? '?includeArchived=true' : ''
      const res = await fetchWithCreds(`${apiBase()}/api/v1/tenant/events/${eventId}/tickets${qs}`)
      const body = await jsonOrThrow<{ data: TierWire[] }>(res)
      return body.data
    },
  })
}

// ─── mutations ────────────────────────────────────────────────────────

export function useCreateTier(eventId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateTierPayload) => {
      const res = await fetchWithCreds(`${apiBase()}/api/v1/tenant/events/${eventId}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await jsonOrThrow<{ data: TierWire }>(res)
      return body.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-tiers', eventId] })
    },
  })
}

export function useUpdateTier(eventId: string, tierId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: UpdateTierPayload) => {
      const res = await fetchWithCreds(
        `${apiBase()}/api/v1/tenant/events/${eventId}/tickets/${tierId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const body = await jsonOrThrow<{ data: TierWire }>(res)
      return body.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-tiers', eventId] })
    },
  })
}

export function useArchiveTier(eventId: string, tierId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { reason?: string } = {}) => {
      const res = await fetchWithCreds(
        `${apiBase()}/api/v1/tenant/events/${eventId}/tickets/${tierId}/archive`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const body = await jsonOrThrow<{ data: TierWire }>(res)
      return body.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-tiers', eventId] })
    },
  })
}

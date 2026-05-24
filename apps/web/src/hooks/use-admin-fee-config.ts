'use client'

/**
 * useAdminFeeConfig — TanStack Query hooks for the super-admin
 * tenant fee-config surface (Sprint 3 Day 23 Workstream 2).
 *
 * Backed endpoints (all super-admin auth):
 *   GET    /api/v1/admin/tenants/:tenantId/fees           — effective fees
 *   GET    /api/v1/admin/tenants/:tenantId/fees/history   — fee_override_log
 *   POST   /api/v1/admin/tenants/:tenantId/fees/override  — set override
 *   POST   /api/v1/admin/tenants/:tenantId/fees/override/clear — reset
 *
 * Cache: default project TanStack Query settings (staleTime 30s). No
 * PII here so no per-query override needed. Mutation success invalidates
 * both list (history) and the effective-fees query so the UI reflects
 * the new state without a page reload.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { FeeHandlingMode } from '@eventpulse/shared-types'

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

// ─── types (mirror the server-side service shapes) ─────────────────────

export interface EffectiveFees {
  platformFeeBps: number
  defaultFeeMode: FeeHandlingMode
  hasOverride: boolean
  effectiveFrom: string | null
  customArrangementNote: string | null
}

export interface FeeOverrideHistoryEntry {
  id: string
  changedBy: string
  previousFeeBps: number
  newFeeBps: number
  previousMode: FeeHandlingMode
  newMode: FeeHandlingMode
  reason: string
  effectiveFrom: string
  createdAt: string
}

export interface SetOverridePayload {
  newFeeBps: number
  newMode: FeeHandlingMode
  reason: string
  effectiveFrom?: string
  customArrangementNote?: string | null
}

export interface ClearOverridePayload {
  reason: string
}

// ─── queries ──────────────────────────────────────────────────────────

export function useEffectiveFees(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['admin-fee-config', tenantId, 'effective'] as const,
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const res = await fetchWithCreds(`${apiBase()}/api/v1/admin/tenants/${tenantId}/fees`)
      const body = await jsonOrThrow<{ data: EffectiveFees }>(res)
      return body.data
    },
  })
}

export function useFeeHistory(tenantId: string | undefined, limit?: number) {
  return useQuery({
    queryKey: ['admin-fee-config', tenantId, 'history', limit] as const,
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const qs = limit ? `?limit=${limit}` : ''
      const res = await fetchWithCreds(
        `${apiBase()}/api/v1/admin/tenants/${tenantId}/fees/history${qs}`,
      )
      const body = await jsonOrThrow<{ data: FeeOverrideHistoryEntry[] }>(res)
      return body.data
    },
  })
}

// ─── mutations ────────────────────────────────────────────────────────

export function useSetOverride(tenantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: SetOverridePayload) => {
      const res = await fetchWithCreds(
        `${apiBase()}/api/v1/admin/tenants/${tenantId}/fees/override`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      return jsonOrThrow<{ data: unknown }>(res)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-fee-config', tenantId] })
    },
  })
}

export function useClearOverride(tenantId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: ClearOverridePayload) => {
      const res = await fetchWithCreds(
        `${apiBase()}/api/v1/admin/tenants/${tenantId}/fees/override/clear`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      return jsonOrThrow<{ data: unknown }>(res)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-fee-config', tenantId] })
    },
  })
}

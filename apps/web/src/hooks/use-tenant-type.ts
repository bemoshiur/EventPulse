'use client'

/**
 * useTenantType — read the current tenant's `type` field from
 * GET /api/v1/tenant/me. Drives the post-login Account-Type modal
 * (Item 11) and any downstream UI that branches on individual vs
 * organisation (KYC wizard variant, reviewer queue, fee surfaces).
 *
 * Sprint 2 Day 16 PR 2: migrated from native fetch + useEffect to
 * TanStack Query's `useQuery`. Interface shape is preserved so existing
 * consumers (`TenantTypeGate`, `AccountTypeModal`) don't change.
 *
 * Decision: .claude/memory/decisions.md 2026-05-18 "TanStack Query
 * lands at Item 12; useTenantType migrated for consistency."
 *
 * State machine (unchanged from Item 11):
 *   isLoading: true  → initial fetch in flight
 *   isLoading: false + type: null    → modal must show
 *   isLoading: false + type: <value> → modal hides
 *   error: <value>   → modal can show an inline error + retry path
 *
 * The account-type setter at `POST /api/v1/tenant/account-type` calls
 * `useInvalidateTenantType()` on success so the modal closes
 * immediately on the next render (no waiting for the 30s stale time
 * to elapse).
 *
 * Endpoint envelope: { data: { tenant: { type: 'individual' | 'organisation' | null, ... } } }
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'

export type TenantType = 'individual' | 'organisation'

export interface UseTenantTypeResult {
  type: TenantType | null
  isLoading: boolean
  error: Error | null
  /** Re-fetch the tenant; consumers call this after a successful POST. */
  refetch: () => Promise<void>
}

interface TenantMeResponse {
  data: {
    tenant: {
      type: TenantType | null
      [key: string]: unknown
    }
  }
}

interface TenantMeError {
  error: { code: string; message: string }
}

/**
 * Canonical query key for the current tenant context. Exported so
 * mutation hooks (account-type setter) can invalidate by key without
 * re-typing the string array.
 */
export const TENANT_ME_QUERY_KEY = ['tenant', 'me'] as const

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

async function fetchTenantMe(): Promise<TenantType | null> {
  const res = await fetch(`${apiBase()}/api/v1/tenant/me`, {
    method: 'GET',
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    try {
      const body = (await res.json()) as TenantMeError
      code = body.error?.code ?? code
    } catch {
      // Body not JSON — surface the status-based code only.
    }
    throw new Error(`tenant /me failed: ${code}`)
  }
  const body = (await res.json()) as TenantMeResponse
  return body.data?.tenant?.type ?? null
}

export function useTenantType(): UseTenantTypeResult {
  const query = useQuery({
    queryKey: TENANT_ME_QUERY_KEY,
    queryFn: fetchTenantMe,
  })

  // Normalise TanStack's distinction (`isLoading` is only true on the
  // first fetch; `isFetching` includes background refetches). The
  // modal needs the first-load signal — `isLoading` is correct.
  return {
    type: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: async () => {
      await query.refetch()
    },
  }
}

/**
 * Returns a function that invalidates the cached `['tenant', 'me']`
 * query, forcing the next read to refetch.
 *
 * Use case (Sprint 2 Day 15 Item 11): the account-type setter modal
 * POSTs to `/tenant/account-type` and, on success, calls
 * `invalidateTenantType()` so the gate's `useTenantType` hook
 * re-resolves immediately instead of waiting for the 30s stale time.
 *
 * Returning the function (rather than the invalidation call itself)
 * is the standard TanStack Query pattern — it lets the consumer call
 * it inside a mutation's `onSuccess` callback without re-rendering on
 * every parent state change.
 */
export function useInvalidateTenantType(): () => Promise<void> {
  const queryClient = useQueryClient()
  return async () => {
    await queryClient.invalidateQueries({ queryKey: TENANT_ME_QUERY_KEY })
  }
}

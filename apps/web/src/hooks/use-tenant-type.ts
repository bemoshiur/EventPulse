'use client'

/**
 * useTenantType — read the current tenant's `type` field from
 * GET /api/v1/tenant/me. Drives the post-login Account-Type modal
 * (Item 11) and any downstream UI that branches on individual vs
 * organisation (KYC wizard variant, reviewer queue, fee surfaces).
 *
 * State machine:
 *   isLoading: true  → initial fetch in flight
 *   isLoading: false + type: null    → modal must show
 *   isLoading: false + type: <value> → modal hides
 *   error: <value>   → modal can show an inline error + retry path;
 *                       NOT a retry loop (we surface to the user
 *                       rather than hide failures behind transparent
 *                       retries).
 *
 * Why native fetch + useEffect, not TanStack Query: TanStack is the
 * planned stack per CLAUDE.md §1.2 but is not yet installed in
 * apps/web/package.json. Adding the dep mid-Item-11 is a §1.4
 * "ask-before-acting" item; Item 12 (KYC wizard) is the natural place
 * to introduce it because that surface needs caching + invalidation +
 * mutations far more than a single read. Until then the hook stays
 * tiny + dep-free.
 *
 * Endpoint envelope: { data: { tenant: { type: 'individual' | 'organisation' | null, ... } } }
 * matches the GET /tenant/me response shape from Item 11's backend.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type TenantType = 'individual' | 'organisation'

export interface UseTenantTypeResult {
  type: TenantType | null
  isLoading: boolean
  error: Error | null
  /** Re-fetch the tenant; the modal calls this after a successful POST. */
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
 * Resolve the API base URL. Defaults to same-origin so local dev works
 * without env config; staging/prod set NEXT_PUBLIC_API_BASE_URL to the
 * api.<env>.eventpulse.com.bd host since Nginx routes web + api on
 * different vhosts (§17.4).
 */
function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

export function useTenantType(): UseTenantTypeResult {
  const [type, setType] = useState<TenantType | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  // mountedRef avoids state updates after unmount (React strict-mode
  // double-mount in dev would otherwise log a setState-after-unmount warning).
  const mountedRef = useRef(true)

  const fetchTenant = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
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
      if (!mountedRef.current) return
      setType(body.data?.tenant?.type ?? null)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err : new Error('tenant /me failed'))
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void fetchTenant()
    return () => {
      mountedRef.current = false
    }
  }, [fetchTenant])

  return { type, isLoading, error, refetch: fetchTenant }
}

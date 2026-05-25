'use client'

/**
 * useTenantPayouts — TanStack Query hook for the tenant payouts view.
 * Sprint 4 Day 33 Phase 3.
 *
 * Backed by: GET /api/v1/tenant/reports/payouts
 *
 * Read-only "what's owed" view. Aggregates over the tenant's
 * snapshotted netToOrganiserPaisa + their current fee config.
 * No PII; default TanStack Query cache settings.
 */

import { useQuery } from '@tanstack/react-query'

// ─── shared API helpers ────────────────────────────────────────────

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

interface ApiErrorBody {
  error: { code: string; message: string }
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

// ─── types ──────────────────────────────────────────────────────────

export interface PayoutsEnvelope {
  data: {
    pendingPayoutPaisa: string
    grossRevenuePaisa: string
    platformFeePaisa: string
    epsFeePaisa: string
    withholdingTaxPaisa: string
    paidOrderCount: number
    refundLeakOrderCount: number
    refundLeakPaisa: string
    currentFees: {
      platformFeeBps: number
      defaultFeeMode: 'absorb' | 'pass_through'
      hasOverride: boolean
      effectiveFrom: string | null
      customArrangementNote: string | null
    }
  }
}

// ─── hook ──────────────────────────────────────────────────────────

export const tenantPayoutsKeys = {
  all: ['tenant', 'payouts'] as const,
}

export function useTenantPayouts() {
  return useQuery({
    queryKey: tenantPayoutsKeys.all,
    queryFn: async () => {
      const url = `${apiBase()}/api/v1/tenant/reports/payouts`
      const res = await fetchWithCreds(url)
      return jsonOrThrow<PayoutsEnvelope>(res)
    },
  })
}

/**
 * Format basis-points as a percent string. 25 → "0.25%".
 *
 * Always 2 decimals — fee precision matters (0.25% vs 0.50%), and
 * consistency across all bps values reads cleaner than switching
 * decimals based on magnitude.
 */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

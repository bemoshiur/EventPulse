'use client'

/**
 * TanStack Query singleton + defaults — Sprint 2 Day 16 PR 2.
 *
 * Decision: .claude/memory/decisions.md 2026-05-18
 *           "TanStack Query lands at Item 12; useTenantType migrated
 *           for consistency."
 *
 * The QueryClient is a singleton shared across the entire tenant
 * portal so cache invalidation (e.g. account-type-setter → invalidate
 * `['tenant','me']`) works across components without prop drilling.
 *
 * Defaults (locked Day 16, see decisions.md):
 *   staleTime              30 s     — tenant portal data changes slowly
 *   gcTime                  5 min   — keep cache around for session length
 *   retry                   1       — one silent retry for network blips
 *   refetchOnWindowFocus   false    — tenant portal is not real-time
 *   refetchOnReconnect     true     — recover after network loss mid-wizard
 *
 * Query-key convention:
 *   ['tenant','me']                  — current tenant context
 *   ['kyc','drafts','list']          — all my draft submissions
 *   ['kyc','drafts', submissionId]   — a specific draft
 *   ['kyc','submissions', submissionId] — a specific submitted submission
 *
 * Nested arrays enable hierarchical invalidation:
 *   invalidateQueries({queryKey:['kyc']})           → all KYC queries
 *   invalidateQueries({queryKey:['kyc','drafts']})  → drafts only
 */

import { QueryClient } from '@tanstack/react-query'

let _client: QueryClient | undefined

/**
 * Return the singleton QueryClient, creating it on first call.
 *
 * Next.js App Router renders both server-side and client-side; on the
 * server every request gets a fresh QueryClient (no module-level
 * singleton survives request boundaries). On the client the singleton
 * persists for the page lifetime, sharing cache across all components.
 *
 * The `let _client` pattern works because this file is `'use client'`
 * — it only runs in the browser, where module state is per-tab.
 */
export function getQueryClient(): QueryClient {
  if (!_client) {
    _client = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          gcTime: 5 * 60_000,
          retry: 1,
          refetchOnWindowFocus: false,
          refetchOnReconnect: true,
        },
      },
    })
  }
  return _client
}

/**
 * Test-only reset hook so each test starts with a fresh cache.
 * Production code never calls this; the singleton lives for the
 * lifetime of the page.
 */
export function __resetQueryClientForTests(): void {
  _client = undefined
}

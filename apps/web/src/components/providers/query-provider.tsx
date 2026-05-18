'use client'

/**
 * `<QueryProvider>` — wraps a subtree in TanStack Query's
 * QueryClientProvider, plus the dev-only ReactQueryDevtools panel.
 *
 * Sprint 2 Day 16 PR 2. Mounted in `apps/web/src/app/(tenant)/layout.tsx`
 * so all tenant portal pages inherit the same cache (and the wizard
 * landing in PR 3 can use TanStack Query hooks without per-page wiring).
 *
 * The devtools import is dev-only by convention (the package itself is
 * a devDependency); `process.env.NODE_ENV === 'development'` gates the
 * render so the panel never ships to production. Tree-shaking + the
 * dynamic import keeps it out of the prod bundle.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import type { ReactNode } from 'react'

import { getQueryClient } from '@/lib/query-client'

// Lazy-load the devtools so the package doesn't end up in the prod
// bundle even if a stale import accidentally references it.
const ReactQueryDevtools = dynamic(
  () =>
    import('@tanstack/react-query-devtools').then((mod) => ({
      default: mod.ReactQueryDevtools,
    })),
  { ssr: false },
)

export function QueryProvider({ children }: { children: ReactNode }) {
  const client = getQueryClient()
  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV === 'development' ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  )
}

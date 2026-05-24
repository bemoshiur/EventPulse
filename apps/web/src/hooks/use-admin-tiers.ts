'use client'

/**
 * useAdminEventTiers — TanStack Query hook for the super-admin
 * ticket-tier read surface (Sprint 3 Day 25).
 *
 * Backed endpoint (super-admin auth):
 *   GET /api/v1/admin/events/:eventId/tickets
 *
 * Returns { event: {id, tenantId, title}, tiers: TierWire[] }.
 * Super-admin sees all tiers including archived per §14.4 ("platform
 * doesn't reach into tenant pricing"); UI surfaces the data without
 * mutation affordances.
 */

import { useQuery } from '@tanstack/react-query'

import type { TierWire } from './use-tenant-tiers.js'

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
    try {
      const body = (await res.json()) as ApiErrorBody
      if (body.error?.message) message = body.error.message
    } catch {
      /* not JSON */
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

export interface AdminEventTiersResponse {
  event: { id: string; tenantId: string; title: string }
  tiers: TierWire[]
}

export function useAdminEventTiers(eventId: string | undefined) {
  return useQuery({
    queryKey: ['admin-event-tiers', eventId] as const,
    enabled: Boolean(eventId),
    queryFn: async () => {
      const res = await fetch(`${apiBase()}/api/v1/admin/events/${eventId}/tickets`, {
        credentials: 'include',
      })
      const body = await jsonOrThrow<{ data: AdminEventTiersResponse }>(res)
      return body.data
    },
  })
}

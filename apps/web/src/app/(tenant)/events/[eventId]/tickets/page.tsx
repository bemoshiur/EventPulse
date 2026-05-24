'use client'

/**
 * Tenant ticket-tier management page — Sprint 3 Day 25.
 *
 * URL: /events/[eventId]/tickets (under the tenant route group).
 *
 * Surface today:
 *   - List active tiers (toggle to include archived)
 *   - Create new tier (form panel)
 *   - Edit existing tier (same form, prefilled)
 *   - Archive tier (soft archive via POST :tierId/archive)
 *
 * Auth: route group wraps with the tenant layout; the API auth gate
 * runs on each fetch. If the API responds 401/403, the page surfaces
 * the message inline (no automatic redirect — that's Sprint 8+ when
 * the my.eventpulse.com.bd routes land properly).
 */

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { GlassCard } from '@/components/ui/glass-card'
import { GradientMesh } from '@/components/ui/gradient-mesh'
import {
  TicketTierForm,
  type TicketTierFormValues,
  tierFormValuesToApiPayload,
  tierWireToFormValues,
} from '@/components/tenant/ticket-tier-form/ticket-tier-form'
import { TicketTierList } from '@/components/tenant/ticket-tier-form/ticket-tier-list'
import {
  useCreateTier,
  useTenantTiers,
  useUpdateTier,
  type TierWire,
} from '@/hooks/use-tenant-tiers'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

export default function TenantTicketTiersPage() {
  const params = useParams<{ eventId: string }>()
  const eventId = params.eventId

  const [includeArchived, setIncludeArchived] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editingTier, setEditingTier] = useState<TierWire | null>(null)
  const [archiveError, setArchiveError] = useState<{ tierId: string; message: string } | null>(null)

  const qc = useQueryClient()
  const tiersQuery = useTenantTiers(eventId, includeArchived)
  const createMutation = useCreateTier(eventId)
  const updateMutation = useUpdateTier(eventId, editingTier?.id ?? '')

  // Single archive mutation, parameterised by tier id on call. Each
  // tier-row's archive button passes its own id through `mutate`.
  const archiveMutation = useMutation({
    mutationFn: async (tierId: string) => {
      const res = await fetch(
        `${apiBase()}/api/v1/tenant/events/${eventId}/tickets/${tierId}/archive`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: '{}',
        },
      )
      if (!res.ok) {
        let message = `HTTP ${res.status}`
        try {
          const body = (await res.json()) as { error?: { message?: string } }
          if (body.error?.message) message = body.error.message
        } catch {
          /* not JSON */
        }
        throw Object.assign(new Error(message), { tierId })
      }
      return tierId
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-tiers', eventId] })
    },
  })

  function handleCreateSubmit(values: TicketTierFormValues) {
    const payload = tierFormValuesToApiPayload(values)
    createMutation.mutate(payload as unknown as Parameters<typeof createMutation.mutate>[0], {
      onSuccess: () => setShowCreate(false),
    })
  }

  function handleEditSubmit(values: TicketTierFormValues) {
    const payload = tierFormValuesToApiPayload(values)
    updateMutation.mutate(payload as unknown as Parameters<typeof updateMutation.mutate>[0], {
      onSuccess: () => setEditingTier(null),
    })
  }

  return (
    <main className="relative min-h-screen">
      <GradientMesh />
      <div className="mx-auto max-w-5xl px-6 py-12">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-ep-ink text-3xl font-semibold">Ticket tiers</h1>
            <p className="text-ep-graphite mt-1 text-sm">
              Per-event tier configuration. Prices in BDT; capacity locking lands Day 29.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-ep-graphite flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
                className="rounded"
              />
              Show archived
            </label>
            {!showCreate && !editingTier && (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="grad-primary inline-flex h-10 items-center rounded-md px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                data-testid="tier-add-button"
              >
                Add tier
              </button>
            )}
          </div>
        </header>

        {showCreate && (
          <div className="mb-8">
            <TicketTierForm
              mode="create"
              onSubmit={handleCreateSubmit}
              onCancel={() => setShowCreate(false)}
              busy={createMutation.isPending}
              errorMessage={createMutation.isError ? (createMutation.error as Error).message : null}
            />
          </div>
        )}

        {editingTier && (
          <div className="mb-8">
            <TicketTierForm
              mode="edit"
              initialValues={tierWireToFormValues(editingTier)}
              onSubmit={handleEditSubmit}
              onCancel={() => setEditingTier(null)}
              busy={updateMutation.isPending}
              errorMessage={updateMutation.isError ? (updateMutation.error as Error).message : null}
            />
          </div>
        )}

        {archiveError && (
          <GlassCard className="mb-3 p-3" data-testid="tier-archive-error">
            <p className="text-ep-rose text-sm" role="alert">
              Archive failed for tier {archiveError.tierId}: {archiveError.message}
            </p>
          </GlassCard>
        )}

        {tiersQuery.isPending && (
          <GlassCard className="p-8">
            <p className="text-ep-graphite text-sm">Loading tiers…</p>
          </GlassCard>
        )}

        {tiersQuery.isError && (
          <GlassCard className="p-6" data-testid="tier-list-error">
            <p className="text-ep-rose text-sm" role="alert">
              Failed to load tiers: {(tiersQuery.error as Error).message}
            </p>
          </GlassCard>
        )}

        {tiersQuery.data && (
          <TicketTierList
            tiers={tiersQuery.data}
            onEdit={(t) => {
              setEditingTier(t)
              setShowCreate(false)
              setArchiveError(null)
            }}
            onArchive={(tier) => {
              setArchiveError(null)
              archiveMutation.mutate(tier.id, {
                onError: (err: unknown) => {
                  setArchiveError({
                    tierId: tier.id,
                    message: err instanceof Error ? err.message : String(err),
                  })
                },
              })
            }}
            busyTierId={archiveMutation.isPending ? (archiveMutation.variables ?? null) : null}
          />
        )}
      </div>
    </main>
  )
}

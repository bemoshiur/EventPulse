'use client'

/**
 * Super-admin ticket-tier read page — Sprint 3 Day 25.
 *
 * URL: /admin/events/[eventId]/tickets (under the admin route group).
 *
 * READ-ONLY per §14.4 — the platform doesn't reach into a tenant's
 * pricing. This page surfaces tier configuration for inspection
 * (AUP triage support, accounting reconciliation, integration
 * support, etc.). No create/edit/archive affordances.
 */

import { useParams } from 'next/navigation'

import { GlassCard } from '@/components/ui/glass-card'
import { GradientMesh } from '@/components/ui/gradient-mesh'

import { useAdminEventTiers } from '@/hooks/use-admin-tiers'

function formatBdt(paisa: string): string {
  const big = BigInt(paisa)
  const wholes = big / 100n
  const fraction = (big % 100n).toString().padStart(2, '0')
  return `${wholes.toString()}.${fraction}`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AdminTicketTiersPage() {
  const params = useParams<{ eventId: string }>()
  const eventId = params.eventId

  const query = useAdminEventTiers(eventId)

  return (
    <main className="relative min-h-screen">
      <GradientMesh />
      <div className="mx-auto max-w-5xl px-6 py-12">
        <header className="mb-8">
          <h1 className="font-display text-ep-ink text-3xl font-semibold">
            Ticket tiers — super-admin view
          </h1>
          <p className="text-ep-graphite mt-1 text-sm">
            Read-only inspection. The platform does not edit tenant tier configuration.
          </p>
        </header>

        {query.isPending && (
          <GlassCard className="p-8">
            <p className="text-ep-graphite text-sm">Loading tiers…</p>
          </GlassCard>
        )}

        {query.isError && (
          <GlassCard className="p-6" data-testid="admin-tier-error">
            <p className="text-ep-rose text-sm" role="alert">
              Failed to load: {(query.error as Error).message}
            </p>
          </GlassCard>
        )}

        {query.data && (
          <>
            <GlassCard className="mb-4 p-4" data-testid="admin-tier-event-summary">
              <dl className="text-ep-graphite grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-ep-graphite/70 text-xs">Event title</dt>
                  <dd className="text-ep-ink">{query.data.event.title}</dd>
                </div>
                <div>
                  <dt className="text-ep-graphite/70 text-xs">Event ID</dt>
                  <dd className="text-ep-ink font-mono text-xs">{query.data.event.id}</dd>
                </div>
                <div>
                  <dt className="text-ep-graphite/70 text-xs">Tenant ID</dt>
                  <dd className="text-ep-ink font-mono text-xs">{query.data.event.tenantId}</dd>
                </div>
              </dl>
            </GlassCard>

            {query.data.tiers.length === 0 ? (
              <GlassCard className="p-8 text-center">
                <p className="text-ep-graphite text-sm">No tiers configured for this event.</p>
              </GlassCard>
            ) : (
              <ul className="grid grid-cols-1 gap-3" data-testid="admin-tier-list">
                {query.data.tiers.map((tier) => {
                  const archived = tier.archivedAt !== null
                  return (
                    <li key={tier.id}>
                      <GlassCard
                        className={`p-5 ${archived ? 'opacity-60' : ''}`}
                        data-testid={`admin-tier-row-${tier.id}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h2 className="text-ep-ink text-lg font-semibold">{tier.name}</h2>
                              {tier.isComplimentary && (
                                <span className="bg-ep-mint/20 text-ep-ink rounded-full px-2 py-0.5 text-xs">
                                  Complimentary
                                </span>
                              )}
                              {archived && (
                                <span className="bg-ep-line/60 text-ep-graphite rounded-full px-2 py-0.5 text-xs">
                                  Archived
                                </span>
                              )}
                            </div>
                            {tier.description && (
                              <p className="text-ep-graphite mt-1 text-sm">{tier.description}</p>
                            )}
                            <dl className="text-ep-graphite mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-4">
                              <div>
                                <dt className="text-ep-graphite/70">Price (BDT)</dt>
                                <dd className="text-ep-ink font-mono">
                                  {formatBdt(tier.pricePaisa)}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-ep-graphite/70">Sold / capacity</dt>
                                <dd className="text-ep-ink">
                                  {tier.sold} / {tier.capacity}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-ep-graphite/70">Sales start</dt>
                                <dd className="text-ep-ink">{formatDateTime(tier.salesStartAt)}</dd>
                              </div>
                              <div>
                                <dt className="text-ep-graphite/70">Sales end</dt>
                                <dd className="text-ep-ink">{formatDateTime(tier.salesEndAt)}</dd>
                              </div>
                              <div>
                                <dt className="text-ep-graphite/70">Per order</dt>
                                <dd className="text-ep-ink">
                                  min {tier.minPerOrder} · max {tier.maxPerOrder}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-ep-graphite/70">Sort</dt>
                                <dd className="text-ep-ink">{tier.sortOrder}</dd>
                              </div>
                            </dl>
                          </div>
                        </div>
                      </GlassCard>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </main>
  )
}

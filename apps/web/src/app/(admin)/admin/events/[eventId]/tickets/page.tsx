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
      <div className="mx-auto max-w-5xl px-6 py-12">
        <header className="mb-8">
          <h1 className="font-display text-mkt-ink text-3xl font-semibold">
            Ticket tiers — super-admin view
          </h1>
          <p className="text-mkt-slate mt-1 text-sm">
            Read-only inspection. The platform does not edit tenant tier configuration.
          </p>
        </header>

        {query.isPending && (
          <div className="mkt-card p-8">
            <p className="text-mkt-slate text-sm">Loading tiers…</p>
          </div>
        )}

        {query.isError && (
          <div className="mkt-card p-6" data-testid="admin-tier-error">
            <p className="text-mkt-red text-sm" role="alert">
              Failed to load: {(query.error as Error).message}
            </p>
          </div>
        )}

        {query.data && (
          <>
            <div className="mkt-card mb-4 p-4" data-testid="admin-tier-event-summary">
              <dl className="text-mkt-slate grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-mkt-slate/70 text-xs">Event title</dt>
                  <dd className="text-mkt-ink">{query.data.event.title}</dd>
                </div>
                <div>
                  <dt className="text-mkt-slate/70 text-xs">Event ID</dt>
                  <dd className="text-mkt-ink font-mono text-xs">{query.data.event.id}</dd>
                </div>
                <div>
                  <dt className="text-mkt-slate/70 text-xs">Tenant ID</dt>
                  <dd className="text-mkt-ink font-mono text-xs">{query.data.event.tenantId}</dd>
                </div>
              </dl>
            </div>

            {query.data.tiers.length === 0 ? (
              <div className="mkt-card p-8 text-center">
                <p className="text-mkt-slate text-sm">No tiers configured for this event.</p>
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-3" data-testid="admin-tier-list">
                {query.data.tiers.map((tier) => {
                  const archived = tier.archivedAt !== null
                  return (
                    <li key={tier.id}>
                      <div
                        className={`mkt-card p-5 ${archived ? 'opacity-60' : ''}`}
                        data-testid={`admin-tier-row-${tier.id}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h2 className="text-mkt-ink text-lg font-semibold">{tier.name}</h2>
                              {tier.isComplimentary && (
                                <span className="bg-ep-mint/20 text-mkt-ink rounded-full px-2 py-0.5 text-xs">
                                  Complimentary
                                </span>
                              )}
                              {archived && (
                                <span className="bg-ep-line/60 text-mkt-slate rounded-full px-2 py-0.5 text-xs">
                                  Archived
                                </span>
                              )}
                            </div>
                            {tier.description && (
                              <p className="text-mkt-slate mt-1 text-sm">{tier.description}</p>
                            )}
                            <dl className="text-mkt-slate mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-4">
                              <div>
                                <dt className="text-mkt-slate/70">Price (BDT)</dt>
                                <dd className="text-mkt-ink font-mono">
                                  {formatBdt(tier.pricePaisa)}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-mkt-slate/70">Sold / capacity</dt>
                                <dd className="text-mkt-ink">
                                  {tier.sold} / {tier.capacity}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-mkt-slate/70">Sales start</dt>
                                <dd className="text-mkt-ink">
                                  {formatDateTime(tier.salesStartAt)}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-mkt-slate/70">Sales end</dt>
                                <dd className="text-mkt-ink">{formatDateTime(tier.salesEndAt)}</dd>
                              </div>
                              <div>
                                <dt className="text-mkt-slate/70">Per order</dt>
                                <dd className="text-mkt-ink">
                                  min {tier.minPerOrder} · max {tier.maxPerOrder}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-mkt-slate/70">Sort</dt>
                                <dd className="text-mkt-ink">{tier.sortOrder}</dd>
                              </div>
                            </dl>
                          </div>
                        </div>
                      </div>
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

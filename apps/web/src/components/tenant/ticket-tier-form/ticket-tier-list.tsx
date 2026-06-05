'use client'

/**
 * Ticket tier list — Sprint 3 Day 25.
 *
 * Renders a tenant's tiers for one event as a table-ish stack of
 * GlassCards. Each row exposes Edit + Archive actions. Archived tiers
 * are visually de-emphasised + their action surface drops to Edit/
 * Archive being disabled.
 */

import type { TierWire } from '@/hooks/use-tenant-tiers'

export interface TicketTierListProps {
  tiers: TierWire[]
  onEdit: (tier: TierWire) => void
  onArchive: (tier: TierWire) => void
  busyTierId?: string | null
}

function formatBdt(paisa: string): string {
  const big = BigInt(paisa)
  const wholes = big / 100n
  const fraction = (big % 100n).toString().padStart(2, '0')
  return `${wholes.toString()}.${fraction}`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function TicketTierList({ tiers, onEdit, onArchive, busyTierId }: TicketTierListProps) {
  if (tiers.length === 0) {
    return (
      <div className="mkt-card p-8 text-center" data-testid="tier-list-empty">
        <p className="text-mkt-slate">No ticket tiers yet. Add one to start selling.</p>
      </div>
    )
  }

  return (
    <ul className="grid grid-cols-1 gap-3" data-testid="tier-list">
      {tiers.map((tier) => {
        const archived = tier.archivedAt !== null
        const isComp = tier.isComplimentary
        return (
          <li key={tier.id}>
            <div
              className={`mkt-card p-5 ${archived ? 'opacity-60' : ''}`}
              data-testid={`tier-row-${tier.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-mkt-ink text-lg font-semibold">{tier.name}</h3>
                    {isComp && (
                      <span className="text-mkt-ink rounded-full bg-emerald-600/20 px-2 py-0.5 text-xs">
                        Complimentary
                      </span>
                    )}
                    {archived && (
                      <span className="bg-mkt-line/60 text-mkt-slate rounded-full px-2 py-0.5 text-xs">
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
                      <dd className="text-mkt-ink font-mono">{formatBdt(tier.pricePaisa)}</dd>
                    </div>
                    <div>
                      <dt className="text-mkt-slate/70">Capacity</dt>
                      <dd className="text-mkt-ink">
                        {tier.sold} / {tier.capacity}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-mkt-slate/70">Sales start</dt>
                      <dd className="text-mkt-ink">{formatDateTime(tier.salesStartAt)}</dd>
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
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => onEdit(tier)}
                    disabled={archived || busyTierId === tier.id}
                    className="border-mkt-line text-mkt-slate hover:text-mkt-ink hover:border-mkt-red inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium transition disabled:opacity-50"
                    data-testid={`tier-edit-${tier.id}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onArchive(tier)}
                    disabled={archived || busyTierId === tier.id}
                    className="text-mkt-red hover:bg-mkt-red/10 inline-flex h-9 items-center rounded-md border border-transparent px-3 text-sm font-medium transition disabled:opacity-50"
                    data-testid={`tier-archive-${tier.id}`}
                  >
                    {archived ? 'Archived' : 'Archive'}
                  </button>
                </div>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

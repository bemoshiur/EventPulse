import type { Metadata } from 'next'

import { TrustCenterLandingGrid } from '@/components/legal/trust-center-landing-grid'
import { fetchTrustCenterLanding } from '@/lib/legal'

// Legal/trust content is DB-seeded; render fresh so updates show immediately
// (the prior 1h ISR served stale placeholders for up to an hour after a content seed).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Trust Center',
  description:
    'Event Pulse legal contracts and trust artefacts — privacy, security, compliance, and responsible use policies.',
}

export default async function TrustCenterLanding() {
  const rows = await fetchTrustCenterLanding()

  return (
    <div className="px-6 py-16 md:py-24">
      <header className="mx-auto mb-16 max-w-3xl text-center">
        <p className="text-mkt-red text-xs font-semibold tracking-widest uppercase">Trust Center</p>
        <h1 className="text-mkt-ink mt-3 text-3xl font-semibold md:text-5xl">
          What Event Pulse stands for
        </h1>
        <p className="text-mkt-slate mt-4 text-base leading-relaxed">
          Six legal contracts and twelve trust artefacts — the contractual foundation of our
          relationship with you, and the standards we hold ourselves to.
        </p>
      </header>

      <TrustCenterLandingGrid rows={rows} />
    </div>
  )
}

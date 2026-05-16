import Link from 'next/link'
import { GradientMesh } from '@/components/ui/gradient-mesh'
import { GlassCard } from '@/components/ui/glass-card'

export default function HomePage() {
  return (
    <main className="relative min-h-screen">
      <GradientMesh />

      <div className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-24 text-center">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-ep-paper/70 px-4 py-1.5 text-xs font-medium text-ep-graphite shadow-sm backdrop-blur">
          Scaffold live · Sprint 1 Day 1–2
        </span>

        <h1 className="font-display text-5xl font-semibold tracking-tight text-ep-ink sm:text-6xl">
          Run your events.{' '}
          <span className="bg-linear-to-r from-ep-violet via-ep-indigo to-ep-cerulean bg-clip-text text-transparent">
            Get paid in 5 days.
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg text-ep-graphite">
          Event Pulse is the ticketing platform built for Bangladesh — branded landing pages,
          drag-and-drop forms, EPS checkout, and T+5 disbursement, on one platform.
        </p>

        <GlassCard variant="strong" className="mt-12 w-full max-w-md p-8">
          <h2 className="font-display text-2xl font-semibold text-ep-ink">Welcome in</h2>
          <p className="mt-2 text-sm text-ep-graphite">
            The platform is in early development. Sign in to follow the build.
          </p>
          <Link
            href="/sign-in"
            className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-md grad-primary px-6 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            Continue to sign in →
          </Link>
        </GlassCard>

        <footer className="mt-16 text-xs text-ep-graphite/70">
          Public Pulse Agency · TiCON System Limited
        </footer>
      </div>
    </main>
  )
}

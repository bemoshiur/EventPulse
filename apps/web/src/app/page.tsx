import Link from 'next/link'
import { GradientMesh } from '@/components/ui/gradient-mesh'
import { GlassCard } from '@/components/ui/glass-card'

export default function HomePage() {
  return (
    <main className="relative min-h-screen">
      <GradientMesh />

      <div className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-24 text-center">
        <span className="bg-ep-paper/70 text-ep-graphite mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium shadow-sm backdrop-blur">
          Scaffold live · Sprint 1 Day 1–2
        </span>

        <h1 className="font-display text-ep-ink text-5xl font-semibold tracking-tight sm:text-6xl">
          Run your events.{' '}
          <span className="bg-linear-to-r from-ep-violet via-ep-indigo to-ep-cerulean bg-clip-text text-transparent">
            Get paid in 5 days.
          </span>
        </h1>

        <p className="text-ep-graphite mt-6 max-w-2xl text-lg">
          Event Pulse is the ticketing platform built for Bangladesh — branded landing pages,
          drag-and-drop forms, EPS checkout, and T+5 disbursement, on one platform.
        </p>

        <GlassCard variant="strong" className="mt-12 w-full max-w-md p-8">
          <h2 className="font-display text-ep-ink text-2xl font-semibold">Welcome in</h2>
          <p className="text-ep-graphite mt-2 text-sm">
            The platform is in early development. Sign in to follow the build.
          </p>
          <Link
            href="/sign-in"
            className="grad-primary mt-6 inline-flex h-11 w-full items-center justify-center rounded-md px-6 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            Continue to sign in →
          </Link>
        </GlassCard>

        <footer className="text-ep-graphite/70 mt-16 text-xs">
          Public Pulse Agency · TiCON System Limited
        </footer>
      </div>
    </main>
  )
}

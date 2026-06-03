import type { Metadata } from 'next'
import Link from 'next/link'
import { MagicLinkForm } from '@/components/auth/magic-link-form'
import { GlassCard } from '@/components/ui/glass-card'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your Event Pulse account.',
}

export default function SignInPage() {
  return (
    <GlassCard variant="strong" className="w-full max-w-md rounded-3xl p-8 sm:p-10">
      <header className="text-center">
        <h1 className="font-display text-ep-ink text-3xl font-semibold tracking-tight">
          Event Pulse
        </h1>
        <p className="text-ep-graphite mt-2 text-sm">Run your events. Get paid in 5 days.</p>
      </header>

      <p className="text-ep-graphite mt-8 text-center text-sm">
        Enter your email and we’ll send you a one-time sign-in link.
      </p>

      <div className="mt-4">
        <MagicLinkForm />
      </div>

      <p className="text-ep-graphite mt-8 text-center text-xs">
        By continuing you agree to our{' '}
        <Link href="/terms" className="text-ep-ink font-medium hover:underline">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="text-ep-ink font-medium hover:underline">
          Privacy Policy
        </Link>
        .
      </p>

      <p className="text-ep-graphite mt-4 text-center text-sm">
        Already have an account?{' '}
        <Link href="/sign-in" className="text-ep-violet font-semibold hover:underline">
          Sign in
        </Link>
      </p>
    </GlassCard>
  )
}

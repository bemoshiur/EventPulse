import type { Metadata } from 'next'
import Link from 'next/link'
import { MagicLinkForm } from '@/components/auth/magic-link-form'
import { OAuthButtonGroup } from '@/components/auth/oauth-button-group'
import { GlassCard } from '@/components/ui/glass-card'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your Event Pulse account.',
}

export default function SignInPage() {
  return (
    <GlassCard variant="strong" className="w-full max-w-md rounded-3xl p-8 sm:p-10">
      <header className="text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ep-ink">
          Event Pulse
        </h1>
        <p className="mt-2 text-sm text-ep-graphite">
          Run your events. Get paid in 5 days.
        </p>
      </header>

      <div className="mt-8">
        <OAuthButtonGroup />
      </div>

      <div className="my-6 flex items-center gap-4 text-xs uppercase tracking-wide text-ep-graphite/60">
        <span className="h-px flex-1 bg-ep-line" />
        or
        <span className="h-px flex-1 bg-ep-line" />
      </div>

      <MagicLinkForm />

      <p className="mt-8 text-center text-xs text-ep-graphite">
        By continuing you agree to our{' '}
        <Link href="/terms" className="font-medium text-ep-ink hover:underline">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="font-medium text-ep-ink hover:underline">
          Privacy Policy
        </Link>
        .
      </p>

      <p className="mt-4 text-center text-sm text-ep-graphite">
        Already have an account?{' '}
        <Link href="/sign-in" className="font-semibold text-ep-violet hover:underline">
          Sign in
        </Link>
      </p>
    </GlassCard>
  )
}

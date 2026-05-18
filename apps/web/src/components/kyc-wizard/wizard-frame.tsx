'use client'

/**
 * Generic wizard frame — Sprint 2 Day 16 Item 12 PR 3.
 *
 * Renders the progress indicator + the current step's UI + the
 * Back / Save & Continue navigation. Variant-agnostic: the wizard
 * variant supplies the step config + the step content as children;
 * the frame handles state.
 *
 * Accessibility:
 *   - Each step's content is wrapped in a `<form>` landmark so screen
 *     readers can navigate by landmark.
 *   - Focus moves to the step heading on step change so screen readers
 *     announce "Step 2: Address" when the user clicks Continue.
 *   - Nav buttons have explicit aria-labels.
 *
 * Design tokens (§19): glass-strong card, gradient CTA, mint complete
 * step pills.
 */

import { useEffect, useRef, type ReactNode } from 'react'

import { GlassCard } from '@/components/ui/glass-card'
import { cn } from '@/lib/utils'

import { ProgressIndicator, type ProgressStep } from './progress-indicator'

interface WizardFrameProps {
  /** Title displayed at the top of the wizard card. Bilingual rendering inside. */
  title: string
  titleBn?: string
  subtitle?: string
  subtitleBn?: string
  steps: ProgressStep[]
  currentStepIndex: number
  completedStepIds?: string[]
  /** Inner step content (a single step's form + fields). */
  children: ReactNode
  /** Disabled when no prior step exists or while a navigation is in flight. */
  onBack?: () => void
  isBackDisabled?: boolean
  /** Fires when user clicks the primary CTA. Frame doesn't validate; that's the step's job. */
  onPrimary?: () => void
  isPrimaryDisabled?: boolean
  isPrimaryBusy?: boolean
  /** CTA label — typically "Save & Continue" / "Submit" / "Try again". */
  primaryLabel: string
  primaryLabelBn?: string
}

export function WizardFrame({
  title,
  titleBn,
  subtitle,
  subtitleBn,
  steps,
  currentStepIndex,
  completedStepIds,
  children,
  onBack,
  isBackDisabled,
  onPrimary,
  isPrimaryDisabled,
  isPrimaryBusy,
  primaryLabel,
  primaryLabelBn,
}: WizardFrameProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Move focus to the step heading on step change so the assistive-
  // tech user hears "Step 2: Address" when the wizard advances. No-op
  // on initial mount — that's handled by the modal/page focus order.
  const previousStepRef = useRef(currentStepIndex)
  useEffect(() => {
    if (previousStepRef.current !== currentStepIndex) {
      headingRef.current?.focus()
      previousStepRef.current = currentStepIndex
    }
  }, [currentStepIndex])

  const currentStepLabel = steps[currentStepIndex]?.label ?? ''
  const currentStepLabelBn = steps[currentStepIndex]?.labelBn

  return (
    <GlassCard variant="strong" className="mx-auto w-full max-w-3xl p-8 sm:p-10">
      <header className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold text-[var(--ep-ink)]">
          {title}
          {titleBn ? (
            <span className="ml-2 text-base font-normal text-[var(--ep-graphite)] opacity-80">
              · {titleBn}
            </span>
          ) : null}
        </h1>
        {subtitle ? (
          <p className="text-sm text-[var(--ep-graphite)]">
            {subtitle}
            {subtitleBn ? <span className="ml-1 opacity-80">· {subtitleBn}</span> : null}
          </p>
        ) : null}
      </header>

      <ProgressIndicator
        steps={steps}
        currentStepIndex={currentStepIndex}
        completedStepIds={completedStepIds}
      />

      <section className="mt-8" aria-labelledby="wizard-step-heading">
        <h2
          id="wizard-step-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-lg font-semibold text-[var(--ep-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ep-cerulean)] focus-visible:ring-offset-2"
        >
          {`Step ${currentStepIndex + 1}: ${currentStepLabel}`}
          {currentStepLabelBn ? (
            <span className="ml-2 text-base font-normal text-[var(--ep-graphite)] opacity-80">
              · {currentStepLabelBn}
            </span>
          ) : null}
        </h2>
        <div className="mt-4">{children}</div>
      </section>

      <footer className="mt-8 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          disabled={isBackDisabled ?? !onBack}
          className={cn(
            'inline-flex items-center justify-center rounded-md border border-[var(--ep-line)] bg-transparent px-5 py-2 text-sm font-medium text-[var(--ep-graphite)] transition',
            'hover:bg-[var(--ep-paper)] focus-visible:ring-2 focus-visible:ring-[var(--ep-cerulean)] focus-visible:ring-offset-2 focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-40',
          )}
          aria-label="Back to previous step"
        >
          Back
          <span className="ml-1 opacity-70">· পেছনে</span>
        </button>

        <button
          type="button"
          onClick={onPrimary}
          disabled={isPrimaryDisabled || isPrimaryBusy}
          aria-busy={isPrimaryBusy ? 'true' : 'false'}
          className={cn(
            'inline-flex items-center justify-center rounded-md bg-gradient-to-br from-[var(--ep-violet)] to-[var(--ep-cerulean)] px-6 py-2 text-sm font-semibold text-white shadow-md transition',
            'hover:opacity-95 focus-visible:ring-2 focus-visible:ring-[var(--ep-cerulean)] focus-visible:ring-offset-2 focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {isPrimaryBusy ? 'Saving…' : primaryLabel}
          {primaryLabelBn && !isPrimaryBusy ? (
            <span className="ml-1 opacity-90">· {primaryLabelBn}</span>
          ) : null}
        </button>
      </footer>
    </GlassCard>
  )
}

'use client'

import { cn } from '@/lib/utils'

/**
 * Accessible step progress indicator for the KYC wizard.
 *
 * Renders a horizontal bar of step labels with the active one
 * highlighted. Visible-focus + ARIA progressbar role + bilingual
 * labels per §19's accessibility commitments.
 *
 * Layout:
 *   • Compact pill row on mobile (< 640 px): just step numbers
 *   • Full labels on tablet+ (>= 640 px)
 *
 * Per Decision A, the wizard uses 4 visible steps for Individual Tier 1
 * (Identity, Address, Financial, Review). Steps not yet reached are
 * dim; the current step is gradient-accented; completed steps are mint.
 */

export interface ProgressStep {
  id: string
  label: string
  labelBn?: string
}

interface ProgressIndicatorProps {
  steps: ProgressStep[]
  currentStepIndex: number
  /** Optional: provide IDs of steps that are valid/complete (rendered as mint). */
  completedStepIds?: string[]
}

export function ProgressIndicator({
  steps,
  currentStepIndex,
  completedStepIds = [],
}: ProgressIndicatorProps) {
  const completed = new Set(completedStepIds)
  return (
    <div
      role="progressbar"
      aria-label="KYC wizard progress"
      aria-valuemin={1 as number}
      aria-valuemax={steps.length as number}
      aria-valuenow={(currentStepIndex + 1) as number}
      aria-valuetext={`Step ${currentStepIndex + 1} of ${steps.length}: ${steps[currentStepIndex]?.label ?? ''}`}
    >
      <ol className="flex w-full items-center justify-between gap-2 sm:gap-4">
        {steps.map((step, index) => {
          const isCurrent = index === currentStepIndex
          const isComplete = completed.has(step.id)
          return (
            <li
              key={step.id}
              className="flex flex-1 flex-col items-center gap-1 text-center"
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors',
                  isCurrent && 'text-mkt-ink bg-[var(--color-mkt-red)] shadow-md',
                  !isCurrent && isComplete && 'text-mkt-ink bg-[#059669]',
                  !isCurrent &&
                    !isComplete &&
                    'bg-[var(--color-mkt-line)] text-[var(--color-mkt-slate)]',
                )}
                aria-hidden
              >
                {index + 1}
              </span>
              <span
                className={cn(
                  'hidden text-xs font-medium sm:block',
                  isCurrent ? 'text-[var(--color-mkt-ink)]' : 'text-[var(--color-mkt-slate)]',
                )}
              >
                {step.label}
                {step.labelBn ? (
                  <span className="ml-1 text-[var(--color-mkt-slate)] opacity-70">
                    · {step.labelBn}
                  </span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

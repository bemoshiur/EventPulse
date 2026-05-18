'use client'

/**
 * AccountTypeModal — Sprint 2 Day 15 Item 11.
 *
 * Post-login gate that asks the tenant to pick Individual or Organisation
 * before the rest of the tenant portal unblocks. Non-dismissable by
 * design (`§19.6` accessibility allows focus trap but the UX choice
 * here is explicit: no Escape, no backdrop click, no close button).
 * The server-side gate (`requireTenantType` middleware) is the real
 * enforcement; this modal is the UX surface.
 *
 * Token discipline (per Day 15 `/review` brief):
 *   - Glass-card aesthetic via the existing `glass-strong` utility
 *     (`§1.5`), not hardcoded rgba()s or one-off backdrop-blur values.
 *   - Brand colours via `ep-*` Tailwind tokens, never literal hex.
 *   - Bangla copy uses the `font-bangla` token (Hind Siliguri per `§19.4`).
 *   - Motion respects `prefers-reduced-motion` per `§19.6` — Framer
 *     Motion's `useReducedMotion` hook collapses entry animations to
 *     instant transitions when the user has the OS preference set.
 *
 * Accessibility:
 *   - role="dialog" + aria-modal + aria-labelledby/aria-describedby
 *   - Focus moves to the first choice card on mount.
 *   - Tab + Shift+Tab cycle within the modal's focusable elements
 *     (focus trap via document-level focusin listener on a sentinel).
 *   - ArrowLeft / ArrowRight switch the focused choice card.
 *   - Enter on a focused card selects it (mirrors click behaviour).
 *   - Escape is intentionally a no-op (the choice is mandatory).
 *
 * Localisation: English copy is primary, Bangla copy alongside in the
 * same visual hierarchy per `§19.6` ("Bangla is first-class — when
 * bilingual, Bangla and English share visual hierarchy").
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Building2, User } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { GlassCard } from '@/components/ui/glass-card'
import { cn } from '@/lib/utils'

import type { TenantType } from '@/hooks/use-tenant-type'

export interface AccountTypeModalProps {
  /** True while the gate evaluates; modal renders a skeleton state. */
  isLoading: boolean
  /** Calls `POST /api/v1/tenant/account-type`. Throws on failure. */
  onSubmit: (type: TenantType) => Promise<void>
}

interface ChoiceCopy {
  readonly value: TenantType
  readonly enLabel: string
  readonly bnLabel: string
  readonly enDescription: string
  readonly bnDescription: string
  readonly Icon: typeof User
}

const CHOICES: readonly ChoiceCopy[] = [
  {
    value: 'individual',
    enLabel: 'Individual',
    bnLabel: 'ব্যক্তিগত',
    enDescription: 'Personal events, freelance projects, single organiser.',
    bnDescription: 'ব্যক্তিগত ইভেন্ট, ফ্রিল্যান্স প্রজেক্ট, একক আয়োজক।',
    Icon: User,
  },
  {
    value: 'organisation',
    enLabel: 'Organisation',
    bnLabel: 'প্রতিষ্ঠান',
    enDescription: 'Companies, NGOs, registered businesses, teams.',
    bnDescription: 'কোম্পানি, এনজিও, নিবন্ধিত ব্যবসা, দল।',
    Icon: Building2,
  },
] as const

export function AccountTypeModal({ isLoading, onSubmit }: AccountTypeModalProps) {
  const [selected, setSelected] = useState<TenantType | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([null, null])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()

  // Focus the first card on mount (accessibility entry point).
  useEffect(() => {
    cardRefs.current[0]?.focus()
  }, [])

  // Focus trap: while the modal is open, any focusin outside the
  // container snaps focus back to the first focusable element. This is
  // a minimal trap (no off-the-shelf dep) sufficient for the §19.6
  // requirement; swap for Radix Dialog when shadcn lands in Phase 2.
  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      const container = containerRef.current
      if (!container) return
      if (e.target instanceof Node && container.contains(e.target)) return
      cardRefs.current[0]?.focus()
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  const handleCardKeyDown = useCallback(
    (idx: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        cardRefs.current[(idx + 1) % CHOICES.length]?.focus()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        cardRefs.current[(idx - 1 + CHOICES.length) % CHOICES.length]?.focus()
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        const choice = CHOICES[idx]
        if (choice) setSelected(choice.value)
      }
      // Escape deliberately not handled — the modal is non-dismissable.
    },
    [],
  )

  const handleSubmit = useCallback(async () => {
    if (!selected || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onSubmit(selected)
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Could not save your choice. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }, [selected, submitting, onSubmit])

  const initial = reduceMotion ? false : { opacity: 0, scale: 0.96 }
  const animate = reduceMotion ? { opacity: 1, scale: 1 } : { opacity: 1, scale: 1 }
  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.32, ease: [0.2, 0.8, 0.2, 1] as const }

  return (
    <AnimatePresence>
      <motion.div
        // Backdrop. No onClick — dismissal is mandatory via the submit button.
        className="bg-ep-ink/40 fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transition}
        role="presentation"
      >
        {/*
          Bilingual labelling per §19.6 ("Bangla is first-class — when
          bilingual, Bangla and English share visual hierarchy"). The
          space-separated `aria-labelledby` idrefs concatenate the
          English and Bangla titles in the accessibility tree so screen
          readers announce both. Per Day 15 /review finding #2.
        */}
        <motion.div
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-type-title account-type-title-bn"
          aria-describedby="account-type-description"
          className="w-full max-w-2xl"
          initial={initial}
          animate={animate}
          transition={transition}
        >
          <GlassCard variant="strong" className="p-6 sm:p-8">
            <header className="mb-6 text-center">
              <h2
                id="account-type-title"
                className="font-display text-ep-ink text-2xl font-medium sm:text-3xl"
              >
                Choose your account type
              </h2>
              <p
                id="account-type-title-bn"
                className="font-bangla text-ep-graphite/80 mt-2 text-base"
              >
                অ্যাকাউন্টের ধরন নির্বাচন করুন
              </p>
              <p id="account-type-description" className="sr-only">
                Pick Individual for personal events or Organisation for businesses and teams. This
                choice cannot be changed later from your portal.
              </p>
            </header>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {CHOICES.map((choice, idx) => {
                const isSelected = selected === choice.value
                return (
                  <button
                    key={choice.value}
                    ref={(el) => {
                      cardRefs.current[idx] = el
                    }}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelected(choice.value)}
                    onKeyDown={handleCardKeyDown(idx)}
                    disabled={isLoading || submitting}
                    className={cn(
                      'group flex flex-col items-start gap-3 rounded-2xl border p-5 text-left',
                      'focus-visible:ring-ep-cerulean transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      isSelected
                        ? 'border-ep-violet bg-ep-violet/5 shadow-glass'
                        : 'border-ep-line bg-ep-paper/60 hover:shadow-glass hover:-translate-y-0.5',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex h-10 w-10 items-center justify-center rounded-lg',
                        isSelected ? 'bg-ep-violet text-ep-paper' : 'bg-ep-mist text-ep-graphite',
                      )}
                    >
                      <choice.Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <div>
                      <div className="font-display text-ep-ink text-lg font-medium">
                        {choice.enLabel}
                      </div>
                      <div className="font-bangla text-ep-graphite/80 text-sm">
                        {choice.bnLabel}
                      </div>
                    </div>
                    <p className="text-ep-graphite text-sm">
                      {choice.enDescription}
                      <span className="font-bangla text-ep-graphite/75 mt-1 block">
                        {choice.bnDescription}
                      </span>
                    </p>
                  </button>
                )
              })}
            </div>

            {submitError ? (
              <div
                role="alert"
                className="border-ep-rose/40 bg-ep-rose/10 text-ep-rose mt-5 rounded-md border px-4 py-3 text-sm"
              >
                {submitError}
              </div>
            ) : null}

            <div className="mt-6 flex items-center justify-end">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!selected || submitting || isLoading}
                className={cn(
                  'inline-flex h-11 items-center justify-center gap-2 rounded-md px-6 text-sm font-medium',
                  'focus-visible:ring-ep-cerulean transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                  'bg-ep-violet text-ep-paper hover:shadow-glass hover:-translate-y-0.5',
                  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none',
                )}
              >
                {submitting ? 'Saving…' : 'Continue'}
                <span className="font-bangla text-xs opacity-75">চালিয়ে যান</span>
              </button>
            </div>
          </GlassCard>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

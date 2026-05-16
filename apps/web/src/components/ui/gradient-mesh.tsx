import { cn } from '@/lib/utils'

type GradientMeshProps = {
  /** `calm` slows the drift for auth screens; `dark` swaps to the dark palette. */
  variant?: 'default' | 'calm' | 'dark'
  className?: string
}

/**
 * Slowly-drifting multi-radial gradient mesh (§1.5).
 *
 * Pure CSS — no JavaScript, no canvas. Sits behind the page with
 * `position: fixed; z-index: -1` so it stays visible during scroll
 * without intercepting pointer events. Respects `prefers-reduced-motion`
 * via the global rule in globals.css.
 */
export function GradientMesh({ variant = 'default', className }: GradientMeshProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'gradient-mesh',
        variant === 'calm' && 'gradient-mesh--calm',
        variant === 'dark' && 'gradient-mesh--dark',
        className,
      )}
    />
  )
}

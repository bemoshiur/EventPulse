import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type GlassVariant = 'default' | 'strong' | 'dark'

type GlassCardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: GlassVariant
}

const variantClass: Record<GlassVariant, string> = {
  default: 'glass',
  strong: 'glass-strong',
  dark: 'glass-dark',
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(function GlassCard(
  { variant = 'default', className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(variantClass[variant], 'rounded-2xl', className)}
      {...rest}
    >
      {children}
    </div>
  )
})

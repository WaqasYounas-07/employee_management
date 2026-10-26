import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/* `tone` mirrors the tones used in lib/constants, so a status object maps
   straight onto a badge without a lookup table at each call site. */
const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors whitespace-nowrap',
  {
    variants: {
      tone: {
        default: 'border-transparent bg-primary/10 text-primary',
        success: 'border-transparent bg-success/12 text-success',
        warning: 'border-transparent bg-warning/15 text-warning',
        destructive: 'border-transparent bg-destructive/10 text-destructive',
        info: 'border-transparent bg-info/12 text-info',
        muted: 'border-transparent bg-muted text-muted-foreground',
        outline: 'border-border text-foreground',
      },
    },
    defaultVariants: { tone: 'default' },
  },
)

const Badge = ({ className, tone, ...props }) => (
  <div className={cn(badgeVariants({ tone }), className)} {...props} />
)

export { Badge, badgeVariants }

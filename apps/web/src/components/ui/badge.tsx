import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-none tracking-wide [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-raised text-muted',
        accent: 'border-accent/50 bg-accent/10 text-accent-text',
        live: 'border-live/40 bg-live/10 text-live',
        success: 'border-success/40 bg-success/10 text-success',
        warning: 'border-warning/40 bg-warning/10 text-warning',
        danger: 'border-danger/40 bg-danger/10 text-danger',
        info: 'border-info/40 bg-info/10 text-info',
        outline: 'border-border-strong bg-transparent text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

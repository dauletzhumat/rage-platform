import { Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  /** Heading level for the title (default h2). */
  headingLevel?: 'h2' | 'h3';
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  headingLevel = 'h2',
  className,
  compact = false,
}: EmptyStateProps) {
  const Heading = headingLevel;
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface/50 text-center',
        compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12',
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-raised text-muted">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <Heading className="text-sm font-semibold text-foreground">{title}</Heading>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

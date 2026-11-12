import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  /** Badges next to the title (status, sample data …). */
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  badges,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-text">
            {eyebrow}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {badges}
        </div>
        {description ? <p className="max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

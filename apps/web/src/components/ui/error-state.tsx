import { TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  title: string;
  description?: ReactNode;
  /** Optional correlation id (safe to show; helps support find server logs). */
  meta?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  headingLevel?: 'h1' | 'h2' | 'h3';
  className?: string;
}

export function ErrorState({
  title,
  description,
  meta,
  icon: Icon = TriangleAlert,
  action,
  headingLevel = 'h2',
  className,
}: ErrorStateProps) {
  const Heading = headingLevel;
  return (
    <div
      role="alert"
      data-slot="error-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-danger/30 bg-danger/5 px-6 py-12 text-center',
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <Heading className="text-base font-semibold text-foreground">{title}</Heading>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {meta ? <p className="font-mono text-xs text-muted">{meta}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

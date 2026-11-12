import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Decorative loading placeholder; hidden from assistive tech. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn('rounded-md bg-raised motion-safe:animate-pulse', className)}
      {...props}
    />
  );
}

export function TableSkeleton({ rows = 8, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex gap-4 bg-raised px-3 py-2.5">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1 bg-overlay" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-t border-border px-3 py-3">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn('h-4 flex-1', c === 0 && 'flex-[2]')} />
          ))}
        </div>
      ))}
    </div>
  );
}

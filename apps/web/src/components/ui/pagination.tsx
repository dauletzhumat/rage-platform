import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from './button';

export interface PaginationLabels {
  nav: string;
  previous: string;
  next: string;
  /** e.g. "Page 2 of 5" */
  status: string;
}

interface PaginationProps {
  page: number;
  totalPages: number;
  /** Hrefs for neighbouring pages; computed by the caller (keeps this a pure component). */
  previousHref: string | null;
  nextHref: string | null;
  labels: PaginationLabels;
  className?: string;
}

/** Previous/next pagination rendered as links (works without JavaScript). */
export function Pagination({
  page,
  totalPages,
  previousHref,
  nextHref,
  labels,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;
  const disabled = cn(
    buttonVariants({ variant: 'secondary', size: 'sm' }),
    'pointer-events-none opacity-40',
  );
  const enabled = buttonVariants({ variant: 'secondary', size: 'sm' });

  return (
    <nav
      aria-label={labels.nav}
      className={cn('flex items-center justify-between gap-3', className)}
    >
      {previousHref && page > 1 ? (
        <Link href={previousHref} rel="prev" className={enabled}>
          <ChevronLeft aria-hidden="true" />
          {labels.previous}
        </Link>
      ) : (
        <span aria-disabled="true" className={disabled}>
          <ChevronLeft aria-hidden="true" />
          {labels.previous}
        </span>
      )}
      <p className="text-xs text-muted tabular" aria-live="polite">
        {labels.status}
      </p>
      {nextHref && page < totalPages ? (
        <Link href={nextHref} rel="next" className={enabled}>
          {labels.next}
          <ChevronRight aria-hidden="true" />
        </Link>
      ) : (
        <span aria-disabled="true" className={disabled}>
          {labels.next}
          <ChevronRight aria-hidden="true" />
        </span>
      )}
    </nav>
  );
}

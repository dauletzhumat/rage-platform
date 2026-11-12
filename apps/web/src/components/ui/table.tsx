import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

interface TableProps extends ComponentProps<'table'> {
  /** Constrain height and keep the header pinned while the body scrolls. */
  stickyHeader?: boolean;
  containerClassName?: string;
}

/**
 * Dense data table (HLTV-like density). Always give it a <TableCaption> —
 * use `srOnly` on the caption when a visible heading already labels the table.
 */
export function Table({
  className,
  containerClassName,
  stickyHeader = false,
  ...props
}: TableProps) {
  return (
    <div
      data-slot="table-container"
      className={cn(
        'relative w-full overflow-x-auto rounded-lg border border-border bg-surface',
        stickyHeader && 'max-h-[32rem] overflow-y-auto',
        containerClassName,
      )}
    >
      <table
        data-sticky={stickyHeader || undefined}
        className={cn(
          'group/table w-full caption-bottom border-collapse text-sm tabular',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function TableCaption({
  className,
  srOnly = false,
  ...props
}: ComponentProps<'caption'> & { srOnly?: boolean }) {
  return (
    <caption
      className={cn(
        srOnly ? 'sr-only' : 'border-t border-border px-3 py-2 text-left text-xs text-muted',
        className,
      )}
      {...props}
    />
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      className={cn(
        'bg-raised group-data-[sticky]/table:sticky group-data-[sticky]/table:top-0 group-data-[sticky]/table:z-10',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn('border-b border-border transition-colors hover:bg-raised/60', className)}
      {...props}
    />
  );
}

export function TableHead({ className, scope = 'col', ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope={scope}
      className={cn(
        'h-8 whitespace-nowrap px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('h-10 px-3 align-middle', className)} {...props} />;
}

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

/** Titled page section with an optional honest empty state. */
export function DetailSection({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn('space-y-3', className)}>
      <h2 id={id} className="text-sm font-semibold uppercase tracking-wider text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function EmptySection({
  id,
  title,
  message,
  icon,
  className,
}: {
  id: string;
  title: string;
  message: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <DetailSection id={id} title={title} {...(className ? { className } : {})}>
      <EmptyState compact headingLevel="h3" title={message} {...(icon ? { icon } : {})} />
    </DetailSection>
  );
}

/** Compact key/value facts list. */
export function Facts({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs uppercase tracking-wider text-muted">{item.label}</dt>
          <dd className="mt-0.5 truncate font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

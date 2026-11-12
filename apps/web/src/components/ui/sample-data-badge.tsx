import { FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * Shown on every entity with `isSample: true`. Deliberately loud (warning
 * colours, icon, text) so seed/demo data can never be mistaken for real results.
 */
export function SampleDataBadge({ className }: { className?: string }) {
  const t = useTranslations('common');
  return (
    <span
      data-slot="sample-data-badge"
      title={t('sampleDataHint')}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-dashed border-warning/70 bg-warning/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-none tracking-wide text-warning',
        className,
      )}
    >
      <FlaskConical aria-hidden="true" className="size-3" />
      {t('sampleData')}
      <span className="sr-only"> — {t('sampleDataHint')}</span>
    </span>
  );
}

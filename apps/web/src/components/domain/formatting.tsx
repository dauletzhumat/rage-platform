import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { cn, initials } from '@/lib/utils';

/** Date/time rendered in UTC (timeZone is fixed in i18n/request.ts) inside a <time> element. */
export function FormattedDate({
  value,
  withTime = false,
  className,
}: {
  value: string | null | undefined;
  withTime?: boolean;
  className?: string;
}) {
  const format = useFormatter();
  const tc = useTranslations('common');
  if (!value) return <span className={cn('text-muted', className)}>{tc('notAvailable')}</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return <span className={cn('text-muted', className)}>{tc('notAvailable')}</span>;
  }
  return (
    <time dateTime={date.toISOString()} className={cn('tabular', className)}>
      {format.dateTime(
        date,
        withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
      )}
      {withTime ? <span className="ml-1 text-muted">{tc('utc')}</span> : null}
    </time>
  );
}

function regionName(code: string, locale: string): string | undefined {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase());
  } catch {
    return undefined;
  }
}

/** ISO 3166-1 alpha-2 code chip + localized country name. No flag images (no third-party assets). */
export function Country({
  code,
  showName = true,
  className,
}: {
  code: string | null | undefined;
  showName?: boolean;
  className?: string;
}) {
  const locale = useLocale();
  const tc = useTranslations('common');
  if (!code) return <span className={cn('text-muted', className)}>{tc('notAvailable')}</span>;
  const name = regionName(code, locale) ?? code.toUpperCase();
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={name}>
      <span
        aria-hidden={showName ? 'true' : undefined}
        className="rounded-sm border border-border bg-raised px-1 font-mono text-[10px] font-semibold leading-4 text-muted"
      >
        {code.toUpperCase()}
      </span>
      {showName ? <span>{name}</span> : <span className="sr-only">{name}</span>}
    </span>
  );
}

/** Initials avatar/logo placeholder (remote images are not loaded in M0). */
export function InitialsAvatar({
  label,
  size = 'md',
  square = false,
}: {
  label: string;
  size?: 'sm' | 'md' | 'lg';
  square?: boolean;
}) {
  const text = initials(label);
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center border border-border bg-raised font-bold text-foreground',
        square ? 'rounded-lg' : 'rounded-full',
        size === 'sm' && 'size-7 text-[10px]',
        size === 'md' && 'size-10 text-xs',
        size === 'lg' && 'size-16 text-lg sm:size-20 sm:text-xl',
      )}
    >
      {text}
    </span>
  );
}

import { useTranslations } from 'next-intl';
import { ShieldX } from 'lucide-react';

/** 403 state: the signed-in user lacks the required role. Renders no data. */
export function ForbiddenState({ title, description }: { title?: string; description?: string }) {
  const t = useTranslations('admin');
  return (
    <section
      data-testid="forbidden"
      aria-labelledby="forbidden-title"
      className="flex flex-col items-center gap-3 rounded-lg border border-danger/30 bg-danger/5 px-6 py-12 text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <ShieldX aria-hidden="true" className="size-6" />
      </span>
      <h2 id="forbidden-title" className="text-lg font-semibold">
        {title ?? t('accessDeniedTitle')}
      </h2>
      <p className="max-w-lg text-sm text-muted">{description ?? t('accessDeniedDescription')}</p>
    </section>
  );
}

import { useTranslations } from 'next-intl';
import { FlaskConical } from 'lucide-react';

/** Persistent notice shown while dev-only demo mode allows actions on sample data. */
export function DemoModeBanner() {
  const t = useTranslations('demoMode');
  return (
    <p
      role="note"
      data-testid="demo-mode-banner"
      className="flex items-start gap-2 rounded-md border border-dashed border-warning/70 bg-warning/10 p-3 text-sm font-medium"
    >
      <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>
        {t('banner')} <span className="font-normal text-muted">{t('bannerDetail')}</span>
      </span>
    </p>
  );
}

import { useTranslations } from 'next-intl';

export const MAIN_CONTENT_ID = 'main-content';

export function SkipLink() {
  const t = useTranslations('common');
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only z-[100] rounded-md bg-accent-strong px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
    >
      {t('skipToContent')}
    </a>
  );
}

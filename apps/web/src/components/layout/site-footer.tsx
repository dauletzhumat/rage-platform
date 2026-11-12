import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Container } from '@/components/ui/container';
import { Logo } from './logo';
import { publicNavItems } from './nav-items';

export function SiteFooter() {
  const t = useTranslations('footer');
  const tn = useTranslations('nav');
  const year = new Date().getUTCFullYear();

  return (
    <footer className="mt-16 border-t border-border bg-surface/40">
      <Container className="grid gap-8 py-10 sm:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-md text-sm text-muted">{t('about')}</p>
          <p className="text-xs text-muted">{t('trademark')}</p>
          <p className="text-xs text-muted">{t('rights', { year })}</p>
        </div>
        <nav aria-label={t('platform')}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            {t('platform')}
          </h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {publicNavItems.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-muted hover:text-foreground">
                  {tn(item.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </footer>
  );
}

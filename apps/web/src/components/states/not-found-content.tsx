import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { SearchX } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Container } from '@/components/ui/container';

export function NotFoundContent() {
  const t = useTranslations('states');
  const tc = useTranslations('common');
  return (
    <Container className="flex flex-col items-center gap-4 py-20 text-center">
      <span className="font-mono text-sm text-accent-text">404</span>
      <SearchX aria-hidden="true" className="size-10 text-muted" />
      <h1 className="text-2xl font-bold tracking-tight">{t('notFoundTitle')}</h1>
      <p className="max-w-md text-sm text-muted">{t('notFoundDescription')}</p>
      <Link href="/" className={buttonVariants({ variant: 'secondary' })}>
        {tc('backHome')}
      </Link>
    </Container>
  );
}

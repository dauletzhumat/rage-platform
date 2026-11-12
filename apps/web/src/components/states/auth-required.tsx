import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Lock, ShieldAlert } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Container } from '@/components/ui/container';

interface AuthRequiredProps {
  /** Page title, rendered as the page's h1 for orientation. */
  pageTitle: string;
  variant?: 'user' | 'admin';
}

/**
 * Honest M0 placeholder for protected routes: no data, no forms.
 * Replaced by real session checks in milestone M1.
 */
export function AuthRequired({ pageTitle, variant = 'user' }: AuthRequiredProps) {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const admin = variant === 'admin';
  const Icon = admin ? ShieldAlert : Lock;

  return (
    <Container className="py-10">
      <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
      <section
        aria-labelledby="auth-required-title"
        data-testid="auth-required"
        className="mt-6 flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-raised text-accent-text">
          <Icon aria-hidden="true" className="size-6" />
        </span>
        <h2 id="auth-required-title" className="text-lg font-semibold">
          {admin ? t('adminRequiredTitle') : t('requiredTitle')}
        </h2>
        <p className="max-w-lg text-sm text-muted">
          {admin ? t('adminRequiredDescription') : t('requiredDescription')}
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link href="/login" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            {t('goToLogin')}
          </Link>
          <Link href="/" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {tc('backHome')}
          </Link>
        </div>
      </section>
    </Container>
  );
}

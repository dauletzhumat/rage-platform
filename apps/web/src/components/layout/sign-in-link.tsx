'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LogIn } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * M0: Steam sign-in does not exist yet. This links to /login, which explains
 * that sign-in arrives in M1 — it never pretends to authenticate.
 */
export function SignInLink({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  return (
    <Link
      href="/login"
      onClick={onNavigate}
      className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), className)}
      title={t('signInUnavailable')}
    >
      <LogIn aria-hidden="true" />
      <span>{t('signInWithSteam')}</span>
      <span className="rounded-sm bg-overlay px-1 py-0.5 font-mono text-[10px] uppercase text-muted">
        {tc('comingInM1')}
      </span>
    </Link>
  );
}

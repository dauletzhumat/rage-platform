'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogIn } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { loginHref } from '@/lib/auth/return-to';
import { cn } from '@/lib/utils';

/** Links to /login, carrying the current page as a (sanitised) returnTo. */
export function SignInLink({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname() ?? '/';
  return (
    <Link
      href={loginHref(pathname)}
      onClick={onNavigate}
      className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), className)}
      data-testid="sign-in-link"
    >
      <LogIn aria-hidden="true" />
      <span>{t('signInWithSteam')}</span>
    </Link>
  );
}

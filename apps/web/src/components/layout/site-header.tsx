import { Suspense } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Container } from '@/components/ui/container';
import { LanguageSwitcher } from './language-switcher';
import { Logo } from './logo';
import { MainNav } from './main-nav';
import { MobileNav } from './mobile-nav';
import { HeaderAccount, HeaderAccountSkeleton } from './header-account';

export function SiteHeader() {
  const t = useTranslations('nav');
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <Container className="flex h-14 items-center gap-4">
        <Link href="/" className="rounded-md" aria-label={`RAGE — ${t('home')}`}>
          <Logo />
        </Link>
        <MainNav className="hidden lg:block" />
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher />
          <div className="hidden lg:block">
            <Suspense fallback={<HeaderAccountSkeleton />}>
              <HeaderAccount variant="desktop" />
            </Suspense>
          </div>
          <MobileNav
            account={
              <Suspense fallback={null}>
                <HeaderAccount variant="mobile" />
              </Suspense>
            }
          />
        </div>
      </Container>
    </header>
  );
}

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Container } from '@/components/ui/container';
import { LanguageSwitcher } from './language-switcher';
import { Logo } from './logo';
import { MainNav } from './main-nav';
import { MobileNav } from './mobile-nav';
import { SignInLink } from './sign-in-link';

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
          <SignInLink className="hidden lg:inline-flex" />
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}

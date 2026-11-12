import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { AdminNav } from './admin-nav';
import { LanguageSwitcher } from './language-switcher';
import { Logo } from './logo';
import { MAIN_CONTENT_ID, SkipLink } from './skip-link';

export function AdminShell({ children }: { children: ReactNode }) {
  const t = useTranslations('admin');
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <Link href="/admin" className="rounded-md">
            <Logo />
          </Link>
          <Badge tone="accent">{t('title')}</Badge>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher />
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">{t('backToSite')}</span>
              <span className="sr-only sm:hidden">{t('backToSite')}</span>
            </Link>
          </div>
        </div>
      </header>
      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="border-b border-border bg-surface/60 px-3 py-3 lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r lg:py-6">
          <AdminNav />
        </aside>
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}

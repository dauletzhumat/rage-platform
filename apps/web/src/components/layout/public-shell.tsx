import type { ReactNode } from 'react';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';
import { MAIN_CONTENT_ID, SkipLink } from './skip-link';

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <SiteHeader />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

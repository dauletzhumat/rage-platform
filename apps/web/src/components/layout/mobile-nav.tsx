'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslations } from 'next-intl';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from './logo';
import { MainNav } from './main-nav';

/**
 * Accessible slide-over navigation for small screens (focus-trapped dialog).
 * `account` is the server-rendered, session-aware account section.
 */
export function MobileNav({ account }: { account: ReactNode }) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);

  // Close the dialog when any link inside the account section is followed.
  function onAccountClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('a')) setOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('openMenu')}>
          <Menu aria-hidden="true" className="size-5" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(20rem,85vw)] flex-col gap-4 border-l border-border bg-surface p-4 shadow-2xl focus:outline-none lg:hidden">
          <div className="flex items-center justify-between">
            <Dialog.Title asChild>
              <span>
                <Logo />
              </span>
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t('closeMenu')}>
                <X aria-hidden="true" className="size-5" />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{t('tagline')}</Dialog.Description>
          <MainNav orientation="vertical" onNavigate={() => setOpen(false)} />
          {/* Click delegation only: links inside handle keyboard activation themselves. */}
          <div className="mt-auto border-t border-border pt-4" onClick={onAccountClick}>
            {account}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronDown, Inbox, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Viewer } from '@/lib/auth/viewer';
import { UserAvatar } from './user-avatar';
import { useSignOut } from './use-sign-out';

/** Desktop account menu for a signed-in user. */
export function AccountMenu({ viewer, className }: { viewer: Viewer; className?: string }) {
  const t = useTranslations('nav');
  const { signOut, pending, failed } = useSignOut();

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        {failed ? (
          <p role="alert" className="text-xs font-medium text-danger">
            {t('signOutFailed')}
          </p>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-2 px-2"
              aria-label={t('account', { name: viewer.nickname })}
              data-testid="account-menu-trigger"
            >
              <UserAvatar name={viewer.nickname} avatarUrl={viewer.avatarUrl} />
              <span className="max-w-32 truncate text-sm font-medium text-foreground">
                {viewer.nickname}
              </span>
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuLabel className="normal-case tracking-normal">
              {viewer.nickname}
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href="/me">
                <UserRound aria-hidden="true" />
                {t('myProfile')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/me/invitations">
                <Inbox aria-hidden="true" />
                {t('invitations')}
              </Link>
            </DropdownMenuItem>
            {viewer.isAdmin ? (
              <DropdownMenuItem asChild>
                <Link href="/admin">
                  <ShieldCheck aria-hidden="true" />
                  {t('admin')}
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={pending}
              onSelect={(event) => {
                event.preventDefault();
                signOut();
              }}
            >
              <LogOut aria-hidden="true" />
              {pending ? t('signingOut') : t('signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

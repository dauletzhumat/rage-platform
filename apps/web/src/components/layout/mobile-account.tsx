'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Inbox, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Viewer } from '@/lib/auth/viewer';
import { UserAvatar } from './user-avatar';
import { useSignOut } from './use-sign-out';

const linkClass =
  'flex h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted hover:bg-raised hover:text-foreground [&_svg]:size-4';

/** Account section inside the mobile navigation dialog. */
export function MobileAccount({ viewer }: { viewer: Viewer }) {
  const t = useTranslations('nav');
  const { signOut, pending, failed } = useSignOut();
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 px-3 pb-2">
        <UserAvatar name={viewer.nickname} avatarUrl={viewer.avatarUrl} />
        <span className="truncate text-sm font-semibold">{viewer.nickname}</span>
      </div>
      <Link href="/me" className={linkClass}>
        <UserRound aria-hidden="true" />
        {t('myProfile')}
      </Link>
      <Link href="/me/invitations" className={linkClass}>
        <Inbox aria-hidden="true" />
        {t('invitations')}
      </Link>
      {viewer.isAdmin ? (
        <Link href="/admin" className={linkClass}>
          <ShieldCheck aria-hidden="true" />
          {t('admin')}
        </Link>
      ) : null}
      <Button
        variant="secondary"
        className="mt-2 w-full"
        onClick={signOut}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        <LogOut aria-hidden="true" />
        {pending ? t('signingOut') : t('signOut')}
      </Button>
      {failed ? (
        <p role="alert" className="px-1 text-xs font-medium text-danger">
          {t('signOutFailed')}
        </p>
      ) : null}
    </div>
  );
}

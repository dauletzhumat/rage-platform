import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Inbox } from 'lucide-react';
import { FormattedDate } from '@/components/domain/formatting';
import { ApiErrorState } from '@/components/states/api-error-state';
import { AcceptInvitationButton, DeclineInvitationButton } from '@/components/teams/team-actions';
import { InvitationStatusBadge } from '@/components/teams/status-badges';
import { Badge } from '@/components/ui/badge';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getMe, getMyInvitations, SLUG_PATTERN } from '@/lib/api/server';
import { INVITATION_STATUSES, type InvitationStatus, type MyInvitationDto } from '@/lib/api/types';
import { loginHref } from '@/lib/auth/return-to';
import { listHref, pickParam, type RawSearchParams } from '@/lib/list-params';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('protected');
  return { title: t('invitationsTitle'), robots: { index: false, follow: false } };
}

/**
 * Invitation inbox (TEAMS.md §4.3, §10). Only the invitee sees and answers their invitations.
 * Status tabs are links (`?status=`), so the view works without JavaScript and each tab is one
 * `GET /me/invitations?status=…` request.
 */
export default async function InvitationsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const [me, tp, t, ts] = await Promise.all([
    getMe(),
    getTranslations('protected'),
    getTranslations('invitations'),
    getTranslations('invitationStatus'),
  ]);
  const status: InvitationStatus =
    pickParam(await searchParams, 'status', INVITATION_STATUSES) ?? 'PENDING';
  if (!me.ok && me.kind === 'unauthenticated') {
    redirect(
      loginHref(listHref('/me/invitations', { status: status === 'PENDING' ? undefined : status })),
    );
  }

  const result = me.ok ? await getMyInvitations(status) : me;
  const membership = me.ok ? (me.data.membership ?? null) : null;

  return (
    <Container className="space-y-6 py-8">
      <PageHeader title={tp('invitationsTitle')} description={t('description')} />

      <nav aria-label={t('filterLabel')} className="overflow-x-auto">
        <ul className="inline-flex min-w-full gap-1 border-b border-border">
          {INVITATION_STATUSES.map((s) => {
            const active = s === status;
            return (
              <li key={s}>
                <Link
                  href={listHref('/me/invitations', { status: s === 'PENDING' ? undefined : s })}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    '-mb-px inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
                    active
                      ? 'border-accent text-foreground'
                      : 'border-transparent text-muted hover:text-foreground',
                  )}
                >
                  {s === 'PENDING' ? t('tabPending') : ts(s)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {status === 'PENDING' && membership ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" role="note">
          {t('inTeamNote', { team: membership.teamName })}
        </p>
      ) : null}

      {!result.ok ? (
        <ApiErrorState failure={result} />
      ) : result.data.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={status === 'PENDING' ? t('emptyPending') : t('emptyHistory')}
          description={status === 'PENDING' ? t('emptyPendingDescription') : undefined}
        />
      ) : (
        <ul className="space-y-3" data-testid="invitation-list">
          {result.data.map((invitation) => (
            <InvitationItem key={invitation.id} invitation={invitation} />
          ))}
        </ul>
      )}
    </Container>
  );
}

async function InvitationItem({ invitation }: { invitation: MyInvitationDto }) {
  const [t, tr] = await Promise.all([getTranslations('invitations'), getTranslations('roles')]);
  const href = SLUG_PATTERN.test(invitation.team.slug)
    ? `/teams/${encodeURIComponent(invitation.team.slug)}`
    : null;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 truncate font-semibold">
            {href ? (
              <Link href={href} className="hover:text-accent-text hover:underline">
                {invitation.team.name}
              </Link>
            ) : (
              invitation.team.name
            )}
          </h2>
          <Badge tone="outline" className="font-mono">
            {invitation.team.tag}
          </Badge>
          <Badge tone={invitation.role === 'PLAYER' ? 'accent' : 'neutral'}>
            {tr(invitation.role)}
          </Badge>
          <InvitationStatusBadge status={invitation.status} />
        </div>
        <p className="text-xs text-muted">
          {t('invitedBy', { name: invitation.invitedBy.nickname })} ·{' '}
          <FormattedDate value={invitation.createdAt} withTime />
        </p>
        <p className="text-xs text-muted">
          {invitation.status === 'PENDING' ? (
            <>
              {t('expires')} <FormattedDate value={invitation.expiresAt} withTime />
            </>
          ) : invitation.respondedAt ? (
            <>
              {t('responded')} <FormattedDate value={invitation.respondedAt} withTime />
            </>
          ) : null}
        </p>
      </div>
      {invitation.status === 'PENDING' ? (
        <div className="flex shrink-0 gap-2">
          <AcceptInvitationButton invitationId={invitation.id} teamName={invitation.team.name} />
          <DeclineInvitationButton invitationId={invitation.id} teamName={invitation.team.name} />
        </div>
      ) : null}
    </li>
  );
}

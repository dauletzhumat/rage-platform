import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MailPlus, Users } from 'lucide-react';
import { FormattedDate, InitialsAvatar } from '@/components/domain/formatting';
import { DetailSection } from '@/components/domain/section';
import { ApiErrorState } from '@/components/states/api-error-state';
import { AuthRequired } from '@/components/states/auth-required';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { InviteForm } from '@/components/teams/invite-form';
import {
  MakeCaptainButton,
  RemoveMemberButton,
  RevokeInvitationButton,
} from '@/components/teams/team-actions';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SampleDataBadge } from '@/components/ui/sample-data-badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getMe, getTeamManage, SLUG_PATTERN } from '@/lib/api/server';
import type { TeamDetailM2, TeamInvitationDto } from '@/lib/api/types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('protected');
  return { title: t('manageTitle'), robots: { index: false, follow: false } };
}

/**
 * Team operator view (TEAMS.md §3, §4.2, §10). The API decides who is an operator:
 * 401 → sign in, 403 → forbidden state (no data), 404 → not found. Buttons follow the
 * `permissions` the API returns; the API re-checks every mutation.
 */
export default async function TeamManagePage({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, tp, t] = await Promise.all([
    params,
    getTranslations('protected'),
    getTranslations('teamManage'),
  ]);
  if (!SLUG_PATTERN.test(slug)) notFound();
  const returnTo = `/teams/${slug}/manage`;

  const me = await getMe();
  if (!me.ok) {
    if (me.kind === 'unauthenticated') {
      return <AuthRequired pageTitle={tp('manageTitle')} returnTo={returnTo} />;
    }
    return (
      <Container className="space-y-6 py-8">
        <PageHeader title={tp('manageTitle')} />
        <ApiErrorState failure={me} />
      </Container>
    );
  }

  const result = await getTeamManage(slug);
  if (!result.ok) {
    if (result.kind === 'not_found') notFound();
    if (result.kind === 'unauthenticated') {
      return <AuthRequired pageTitle={tp('manageTitle')} returnTo={returnTo} />;
    }
    return (
      <Container className="space-y-6 py-8">
        <PageHeader title={tp('manageTitle')} />
        {result.kind === 'forbidden' ? (
          <ForbiddenState title={t('forbiddenTitle')} description={t('forbiddenDescription')} />
        ) : (
          <ApiErrorState failure={result} />
        )}
      </Container>
    );
  }

  const { team, pendingInvitations, permissions, rosterCap, pendingInvitationCap } = result.data;
  const viewerId = me.data.user.id;
  const publicHref = `/teams/${encodeURIComponent(team.slug)}`;
  const rosterFull = team.activeMemberCount >= rosterCap;
  const pendingFull = pendingInvitations.length >= pendingInvitationCap;
  const readOnly = team.isSample;

  return (
    <Container className="space-y-8 py-8">
      <PageHeader
        eyebrow={tp('manageTitle')}
        title={team.name}
        badges={
          <>
            <Badge tone="outline" className="font-mono">
              {team.tag}
            </Badge>
            {team.isSample ? <SampleDataBadge /> : null}
          </>
        }
        description={t('description')}
        actions={
          <Link href={publicHref} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            {t('viewPublic')}
          </Link>
        }
      />

      {readOnly ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" role="note">
          {t('sampleReadOnly')}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 sm:max-w-md" data-testid="team-caps">
        <div className="rounded-lg border border-border bg-surface p-3">
          <dt className="text-xs uppercase tracking-wider text-muted">{t('rosterCount')}</dt>
          <dd
            className={rosterFull ? 'text-lg font-semibold text-warning' : 'text-lg font-semibold'}
          >
            {t('countOf', { count: team.activeMemberCount, max: rosterCap })}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <dt className="text-xs uppercase tracking-wider text-muted">{t('pendingCount')}</dt>
          <dd
            className={pendingFull ? 'text-lg font-semibold text-warning' : 'text-lg font-semibold'}
          >
            {t('countOf', { count: pendingInvitations.length, max: pendingInvitationCap })}
          </dd>
        </div>
      </dl>

      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <DetailSection id="manage-roster" title={t('roster')}>
          {team.roster.length === 0 ? (
            <EmptyState compact headingLevel="h3" icon={Users} title={t('rosterEmpty')} />
          ) : (
            <RosterTable
              team={team}
              viewerId={viewerId}
              canRemove={permissions.canRemove && !readOnly}
              canTransfer={permissions.canTransfer && !readOnly}
            />
          )}
        </DetailSection>

        <div className="space-y-8">
          {permissions.canInvite && !readOnly ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('inviteTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted">{t('inviteDescription')}</p>
                {pendingFull ? (
                  <p className="text-sm text-warning" role="note">
                    {t('pendingCapReached', { max: pendingInvitationCap })}
                  </p>
                ) : rosterFull ? (
                  <p className="text-sm text-warning" role="note">
                    {t('rosterFullNote', { max: rosterCap })}
                  </p>
                ) : null}
                <InviteForm teamId={team.id} disabled={pendingFull} />
              </CardContent>
            </Card>
          ) : null}

          <DetailSection id="pending-invitations" title={t('pendingTitle')}>
            {pendingInvitations.length === 0 ? (
              <EmptyState compact headingLevel="h3" icon={MailPlus} title={t('pendingEmpty')} />
            ) : (
              <ul className="space-y-2" data-testid="pending-invitations">
                {pendingInvitations.map((invitation) => (
                  <PendingInvitationItem
                    key={invitation.id}
                    teamId={team.id}
                    invitation={invitation}
                    canRevoke={permissions.canInvite && !readOnly}
                  />
                ))}
              </ul>
            )}
          </DetailSection>
        </div>
      </div>
    </Container>
  );
}

async function RosterTable({
  team,
  viewerId,
  canRemove,
  canTransfer,
}: {
  team: TeamDetailM2;
  viewerId: string;
  canRemove: boolean;
  canTransfer: boolean;
}) {
  const [t, tr, tm] = await Promise.all([
    getTranslations('teams'),
    getTranslations('roles'),
    getTranslations('teamManage'),
  ]);
  return (
    <Table>
      <TableCaption srOnly>{t('rosterCaption', { team: team.name })}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{t('players')}</TableHead>
          <TableHead>{t('role')}</TableHead>
          <TableHead className="hidden sm:table-cell">{t('joined')}</TableHead>
          <TableHead>
            <span className="sr-only">{tm('actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {team.roster.map((member) => {
          const isCaptain = member.role === 'CAPTAIN';
          const isSelf = member.userId === viewerId;
          const userId = member.userId;
          return (
            <TableRow key={member.userId ?? `${member.playerSlug}-${member.role}`}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <InitialsAvatar label={member.nickname} size="sm" />
                  <Link
                    href={`/players/${encodeURIComponent(member.playerSlug)}`}
                    className="font-medium hover:text-accent-text hover:underline"
                  >
                    {member.nickname}
                  </Link>
                  {isSelf ? <Badge tone="info">{tm('you')}</Badge> : null}
                </div>
              </TableCell>
              <TableCell>
                <Badge tone={isCaptain ? 'accent' : 'neutral'}>{tr(member.role)}</Badge>
              </TableCell>
              <TableCell className="hidden text-muted sm:table-cell">
                <FormattedDate value={member.joinedAt} />
              </TableCell>
              <TableCell>
                {userId && !isCaptain && !isSelf ? (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {canTransfer ? (
                      <MakeCaptainButton
                        teamId={team.id}
                        userId={userId}
                        nickname={member.nickname}
                      />
                    ) : null}
                    {canRemove ? (
                      <RemoveMemberButton
                        teamId={team.id}
                        userId={userId}
                        nickname={member.nickname}
                      />
                    ) : null}
                  </div>
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

async function PendingInvitationItem({
  teamId,
  invitation,
  canRevoke,
}: {
  teamId: string;
  invitation: TeamInvitationDto;
  canRevoke: boolean;
}) {
  const [t, tr] = await Promise.all([getTranslations('teamManage'), getTranslations('roles')]);
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/players/${encodeURIComponent(invitation.invitee.playerSlug)}`}
            className="truncate font-medium hover:text-accent-text hover:underline"
          >
            {invitation.invitee.nickname}
          </Link>
          <Badge tone="neutral">{tr(invitation.role)}</Badge>
        </div>
        <p className="font-mono text-xs text-muted">{invitation.invitee.steamId64}</p>
        <p className="text-xs text-muted">
          {t('invitedBy', { name: invitation.invitedBy.nickname })} · {t('expires')}{' '}
          <FormattedDate value={invitation.expiresAt} withTime />
        </p>
      </div>
      {canRevoke ? (
        <RevokeInvitationButton
          teamId={teamId}
          invitationId={invitation.id}
          nickname={invitation.invitee.nickname}
        />
      ) : null}
    </li>
  );
}

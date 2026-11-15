import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CalendarX, ShieldQuestion, Users } from 'lucide-react';
import { FormattedDate } from '@/components/domain/formatting';
import { DetailSection } from '@/components/domain/section';
import { TournamentStatusPill } from '@/components/domain/status';
import { ApiErrorState } from '@/components/states/api-error-state';
import { AuthRequired } from '@/components/states/auth-required';
import { ForbiddenState } from '@/components/states/forbidden-state';
import {
  RosterSelectionForm,
  type RosterCandidate,
} from '@/components/tournaments/roster-selection-form';
import {
  RegistrationStatusBadge,
  RosterRoleBadge,
  RosterStatusBadge,
} from '@/components/tournaments/status-badges';
import { WithdrawRegistrationButton } from '@/components/tournaments/tournament-actions';
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
import { getMe, getMyRegistrations, getTeam, getTournament, SLUG_PATTERN } from '@/lib/api/server';
import type { RegistrationDto, TeamDetailM2 } from '@/lib/api/types';
import type { RawSearchParams } from '@/lib/list-params';
import { operatedTeamIds, operatedTeamSlugs } from '@/lib/tournaments/access';
import type { RosterChoice } from '@/lib/tournaments/validation';
import { cn } from '@/lib/utils';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawSearchParams>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tournamentRegister');
  return { title: t('title'), robots: { index: false, follow: false } };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Team operator registration (docs/TOURNAMENTS.md §4, §13). The team is the captain's membership
 * team, or `?team=<slug>` for a TEAM_MANAGER (their grant carries only the team id). The API
 * decides who is an operator and re-validates every roster.
 */
export default async function TournamentRegisterPage({ params, searchParams }: Props) {
  const [{ slug }, raw, t, tt] = await Promise.all([
    params,
    searchParams,
    getTranslations('tournamentRegister'),
    getTranslations('tournaments'),
  ]);
  if (!SLUG_PATTERN.test(slug)) notFound();
  const returnTo = `/tournaments/${slug}/register`;

  const me = await getMe();
  if (!me.ok) {
    if (me.kind === 'unauthenticated') {
      return <AuthRequired pageTitle={t('title')} returnTo={returnTo} />;
    }
    return (
      <Container className="space-y-6 py-8">
        <PageHeader title={t('title')} />
        <ApiErrorState failure={me} />
      </Container>
    );
  }

  const [tournamentResult, registrationsResult] = await Promise.all([
    getTournament(slug),
    getMyRegistrations(),
  ]);
  if (!tournamentResult.ok) {
    if (tournamentResult.kind === 'not_found') notFound();
    return (
      <Container className="space-y-6 py-8">
        <PageHeader title={t('title')} />
        <ApiErrorState failure={tournamentResult} />
      </Container>
    );
  }
  const tournament = tournamentResult.data;
  const tournamentHref = `/tournaments/${encodeURIComponent(tournament.slug)}`;
  const operated = operatedTeamIds(me.data);
  const myRegistrations = registrationsResult.ok ? registrationsResult.data : [];
  const forThisTournament = myRegistrations.filter((r) => r.tournament.id === tournament.id);

  // Candidate team slugs the viewer may operate (captain team, existing registrations, ?team=).
  // Teams the viewer operates: captain team + TEAM_MANAGER grants (`scopeSlug`). `?team=` only
  // selects among them when the viewer operates several.
  const requested = first(raw.team);
  const knownSlugs = new Set<string>(operatedTeamSlugs(me.data));
  for (const r of forThisTournament) knownSlugs.add(r.team.slug);
  const teamSlug =
    requested && SLUG_PATTERN.test(requested) && knownSlugs.has(requested)
      ? requested
      : (forThisTournament[0]?.team.slug ?? [...knownSlugs][0]);

  const header = (
    <PageHeader
      eyebrow={t('title')}
      title={
        <Link href={tournamentHref} className="hover:text-accent-text">
          {tournament.name}
        </Link>
      }
      badges={
        <>
          <TournamentStatusPill status={tournament.status} />
          {tournament.isSample ? <SampleDataBadge /> : null}
        </>
      }
      description={t('description')}
    />
  );

  if (!teamSlug || operated.size === 0) {
    return (
      <Container className="space-y-8 py-8">
        {header}
        <EmptyState
          icon={ShieldQuestion}
          title={t('noTeamTitle')}
          description={t('noTeamDescription')}
          action={
            <Link
              href="/teams/apply"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              {t('applyForTeam')}
            </Link>
          }
        />
      </Container>
    );
  }

  const teamResult = await getTeam(teamSlug);
  if (!teamResult.ok) {
    if (teamResult.kind === 'not_found') notFound();
    return (
      <Container className="space-y-8 py-8">
        {header}
        <ApiErrorState failure={teamResult} />
      </Container>
    );
  }
  const team = teamResult.data as TeamDetailM2;
  if (!operated.has(team.id)) {
    return (
      <Container className="space-y-8 py-8">
        {header}
        <ForbiddenState title={t('notOperatorTitle')} description={t('notOperatorDescription')} />
      </Container>
    );
  }

  const registration = forThisTournament.find((r) => r.team.id === team.id) ?? null;
  const otherTeams = [...knownSlugs].filter((s) => s !== team.slug);
  const candidates: RosterCandidate[] = team.roster.map((m) => ({
    userId: m.userId,
    nickname: m.nickname,
    teamRole: m.role,
  }));
  // API-computed: status REGISTRATION_OPEN and now() inside the optional window.
  const registrationOpen = tournament.registrationOpen;
  const readOnly = tournament.isSample || team.isSample;
  const canWithdraw =
    registration !== null &&
    (registration.status === 'PENDING' || registration.status === 'APPROVED') &&
    (tournament.status === 'REGISTRATION_OPEN' || tournament.status === 'REGISTRATION_CLOSED') &&
    !readOnly;

  return (
    <Container className="space-y-8 py-8">
      {header}

      {otherTeams.length > 0 ? (
        <nav aria-label={t('teamPicker')} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{t('teamPicker')}</span>
          {[team.slug, ...otherTeams].map((s) => (
            <Link
              key={s}
              href={`${returnTo}?team=${encodeURIComponent(s)}`}
              aria-current={s === team.slug ? 'page' : undefined}
              className={cn(
                'rounded-full border px-3 py-1 text-xs',
                s === team.slug ? 'border-accent bg-accent/10' : 'border-border text-muted',
              )}
            >
              {s}
            </Link>
          ))}
        </nav>
      ) : null}

      {readOnly ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" role="note">
          {t('sampleReadOnly')}
        </p>
      ) : null}

      {!registrationsResult.ok ? <ApiErrorState failure={registrationsResult} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {t('teamHeading', { team: team.name })}{' '}
            <Badge tone="outline" className="ml-1 font-mono">
              {team.tag}
            </Badge>
          </CardTitle>
          {registration ? <RegistrationStatusBadge status={registration.status} /> : null}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted">
            {t('window')} <FormattedDate value={tournament.registrationOpenAt} withTime /> –{' '}
            <FormattedDate value={tournament.registrationCloseAt} withTime />
          </p>
          {registration?.status === 'REJECTED' && registration.reviewReason ? (
            <p className="whitespace-pre-line break-words rounded-md border border-danger/40 bg-danger/10 p-3">
              <span className="font-medium">{t('rejectedReason')}</span> {registration.reviewReason}
            </p>
          ) : null}
          {registration?.status === 'APPROVED' ? <p>{t('approvedNote')}</p> : null}
          {canWithdraw && registration ? (
            <WithdrawRegistrationButton
              tournamentId={tournament.id}
              registrationId={registration.id}
              teamName={team.name}
            />
          ) : null}
        </CardContent>
      </Card>

      {registration ? <SnapshotTable registration={registration} /> : null}

      {readOnly ? null : registration ? (
        registration.status === 'PENDING' ? (
          <DetailSection id="edit-roster" title={t('editRoster')}>
            <p className="text-sm text-muted">{t('editRosterHint')}</p>
            <RosterSelectionForm
              tournamentId={tournament.id}
              teamId={team.id}
              candidates={candidates}
              initial={initialChoices(registration)}
              registrationId={registration.id}
            />
            <DepartedNote registration={registration} candidates={candidates} />
          </DetailSection>
        ) : registration.status === 'REJECTED' || registration.status === 'WITHDRAWN' ? (
          <p
            role="note"
            data-testid="no-reregister"
            className="rounded-md border border-border bg-raised p-3 text-sm text-muted"
          >
            {t('noReRegister')}
          </p>
        ) : null
      ) : registrationOpen ? (
        <DetailSection id="choose-roster" title={t('chooseRoster')}>
          <p className="text-sm text-muted">{t('chooseRosterHint')}</p>
          {candidates.length === 0 ? (
            <EmptyState compact headingLevel="h3" icon={Users} title={t('noMembers')} />
          ) : (
            <RosterSelectionForm
              tournamentId={tournament.id}
              teamId={team.id}
              candidates={candidates}
              initial={defaultChoices(team)}
            />
          )}
        </DetailSection>
      ) : (
        <EmptyState
          icon={CalendarX}
          title={t('closedTitle')}
          description={tt('registrationClosedHint')}
        />
      )}
    </Container>
  );
}

function initialChoices(registration: RegistrationDto): Record<string, RosterChoice> {
  const result: Record<string, RosterChoice> = {};
  for (const entry of registration.roster.entries) result[entry.userId] = entry.role;
  return result;
}

/** Suggestion only: captain + players as starters, team substitutes as substitutes. */
function defaultChoices(team: TeamDetailM2): Record<string, RosterChoice> {
  const result: Record<string, RosterChoice> = {};
  for (const member of team.roster) {
    if (!member.userId) continue;
    result[member.userId] = member.role === 'SUBSTITUTE' ? 'SUBSTITUTE' : 'STARTER';
  }
  return result;
}

async function DepartedNote({
  registration,
  candidates,
}: {
  registration: RegistrationDto;
  candidates: RosterCandidate[];
}) {
  const t = await getTranslations('tournamentRegister');
  const current = new Set(candidates.map((c) => c.userId));
  const departed = registration.roster.entries.filter((e) => !current.has(e.userId));
  if (departed.length === 0) return null;
  return (
    <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" role="note">
      {t('departed', { names: departed.map((e) => e.nickname).join(', ') })}
    </p>
  );
}

async function SnapshotTable({ registration }: { registration: RegistrationDto }) {
  const t = await getTranslations('tournamentRegister');
  const roster = registration.roster;
  return (
    <DetailSection id="snapshot" title={t('snapshotTitle')}>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <RosterStatusBadge status={roster.status} />
        <span>{t('snapshotVersion', { version: roster.version })}</span>
        {roster.lockedAt ? (
          <span>
            {t('lockedAt')} <FormattedDate value={roster.lockedAt} withTime />
          </span>
        ) : null}
      </div>
      <Table>
        <TableCaption srOnly>{t('snapshotCaption', { team: registration.team.name })}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colPlayer')}</TableHead>
            <TableHead>{t('colRole')}</TableHead>
            <TableHead className="hidden sm:table-cell">{t('colSteamId')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roster.entries.map((entry) => (
            <TableRow key={entry.userId}>
              <TableCell className="font-medium">
                {SLUG_PATTERN.test(entry.playerSlug) ? (
                  <Link
                    href={`/players/${encodeURIComponent(entry.playerSlug)}`}
                    className="hover:text-accent-text hover:underline"
                  >
                    {entry.nickname}
                  </Link>
                ) : (
                  entry.nickname
                )}
              </TableCell>
              <TableCell>
                <RosterRoleBadge role={entry.role} />
              </TableCell>
              <TableCell className="hidden font-mono text-xs text-muted sm:table-cell">
                {entry.steamId64}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DetailSection>
  );
}

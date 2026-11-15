import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { GitBranch, Map as MapIcon, Users } from 'lucide-react';
import { FormattedDate } from '@/components/domain/formatting';
import { DetailSection, EmptySection, Facts } from '@/components/domain/section';
import { TournamentStatusPill } from '@/components/domain/status';
import { ApiErrorState } from '@/components/states/api-error-state';
import { BracketView } from '@/components/tournaments/bracket-view';
import {
  ApprovedTeams,
  MapPoolList,
  RegistrationWindowNotice,
  registrationWindowState,
} from '@/components/tournaments/tournament-parts';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SampleDataBadge } from '@/components/ui/sample-data-badge';
import { getMe, getTournament, getTournamentBracket, getTournamentTeams } from '@/lib/api/server';
import { requestTime } from '@/lib/display-time';
import { operatedTeamIds } from '@/lib/tournaments/access';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [result, t] = await Promise.all([getTournament(slug), getTranslations('tournaments')]);
  if (!result.ok) return { title: t('title'), robots: { index: false } };
  return {
    title: result.data.name,
    description: result.data.description ?? t('description'),
    ...(result.data.isSample ? { robots: { index: false } } : {}),
  };
}

/**
 * Public tournament page (docs/TOURNAMENTS.md §13): overview, map pool, bracket, approved teams
 * with locked rosters. Public data is fetched without the session; `/me` is read only to decide
 * whether to offer the operator "Register team" link (UX only — the API authorises).
 */
export default async function TournamentPage({ params }: Props) {
  const { slug } = await params;
  const [result, t, tf] = await Promise.all([
    getTournament(slug),
    getTranslations('tournaments'),
    getTranslations('tournamentFormat'),
  ]);

  if (!result.ok) {
    if (result.kind === 'not_found') notFound();
    return (
      <Container className="py-8">
        <h1 className="sr-only">{t('title')}</h1>
        <ApiErrorState failure={result} />
      </Container>
    );
  }

  const tournament = result.data;
  const [teams, bracket, me] = await Promise.all([
    getTournamentTeams(tournament.slug),
    getTournamentBracket(tournament.slug),
    getMe(),
  ]);

  const mapPool = Array.isArray(tournament.mapPool) ? tournament.mapPool : [];
  const operates = me.ok && operatedTeamIds(me.data).size > 0;
  const registrationOpen = tournament.registrationOpen;
  const showRegister = operates && !tournament.isSample && registrationOpen;
  const windowState = registrationWindowState(tournament, requestTime());
  // Signed in, window open, but no team to operate: explain instead of showing nothing.
  const showOperatorHint = me.ok && !operates && registrationOpen && !tournament.isSample;
  const approvedCount =
    typeof tournament.approvedTeamCount === 'number'
      ? tournament.approvedTeamCount
      : tournament.registeredTeamCount;

  return (
    <Container className="space-y-8 py-8">
      <PageHeader
        eyebrow={t('tournament')}
        title={tournament.name}
        badges={
          <>
            <TournamentStatusPill status={tournament.status} />
            {tournament.isSample ? <SampleDataBadge /> : null}
          </>
        }
        actions={
          showRegister ? (
            <Link
              href={`/tournaments/${encodeURIComponent(tournament.slug)}/register`}
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
              data-testid="register-team-link"
            >
              {t('registerTeam')}
            </Link>
          ) : null
        }
      />

      <RegistrationWindowNotice
        state={windowState}
        registrationOpenAt={tournament.registrationOpenAt}
        registrationCloseAt={tournament.registrationCloseAt}
      />
      {showOperatorHint ? (
        <p
          role="note"
          data-testid="operator-only-hint"
          className="rounded-md border border-border bg-raised p-3 text-sm text-muted"
        >
          {t('operatorOnlyHint')}
        </p>
      ) : null}

      <Card>
        <CardContent>
          <Facts
            items={[
              {
                label: t('format'),
                value:
                  tournament.format === 'SINGLE_ELIMINATION'
                    ? tf('SINGLE_ELIMINATION')
                    : tournament.format,
              },
              {
                label: t('matchFormat'),
                value: tournament.defaultMatchFormat ?? t('tbd'),
              },
              {
                label: t('finalFormat'),
                value: tournament.finalMatchFormat ?? tournament.defaultMatchFormat ?? t('tbd'),
              },
              {
                label: t('teams'),
                value: (
                  <span className="tabular">
                    {typeof tournament.maxTeams === 'number'
                      ? t('teamsOfMax', { count: approvedCount, max: tournament.maxTeams })
                      : approvedCount}
                  </span>
                ),
              },
              {
                label: t('startsAt'),
                value: <FormattedDate value={tournament.startsAt} withTime />,
              },
              {
                label: t('registrationOpens'),
                value: <FormattedDate value={tournament.registrationOpenAt} withTime />,
              },
              {
                label: t('registrationCloses'),
                value: <FormattedDate value={tournament.registrationCloseAt} withTime />,
              },
            ]}
          />
        </CardContent>
      </Card>

      <DetailSection id="overview" title={t('overview')}>
        <p className="max-w-3xl whitespace-pre-line break-words text-sm text-muted">
          {tournament.description || t('noDescription')}
        </p>
      </DetailSection>

      {mapPool.length > 0 ? (
        <DetailSection id="map-pool" title={t('mapPool')}>
          <MapPoolList maps={mapPool} />
        </DetailSection>
      ) : (
        <EmptySection
          id="map-pool"
          title={t('mapPool')}
          message={t('mapPoolEmpty')}
          icon={MapIcon}
        />
      )}

      <DetailSection id="bracket" title={t('bracket')}>
        {bracket.ok && bracket.data.rounds.length > 0 ? (
          <BracketView bracket={bracket.data} />
        ) : bracket.ok || bracket.kind === 'not_found' ? (
          <EmptyState compact headingLevel="h3" icon={GitBranch} title={t('bracketEmpty')} />
        ) : (
          <ApiErrorState failure={bracket} headingLevel="h3" />
        )}
      </DetailSection>

      <DetailSection id="participants" title={t('participants')}>
        {!teams.ok ? (
          teams.kind === 'not_found' ? (
            <EmptyState compact headingLevel="h3" icon={Users} title={t('participantsEmpty')} />
          ) : (
            <ApiErrorState failure={teams} headingLevel="h3" />
          )
        ) : teams.data.length === 0 ? (
          <EmptyState compact headingLevel="h3" icon={Users} title={t('participantsEmpty')} />
        ) : (
          <ApprovedTeams teams={teams.data} />
        )}
      </DetailSection>
    </Container>
  );
}

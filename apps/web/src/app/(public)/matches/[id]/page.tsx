import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BarChart3, Map as MapIcon, ShieldAlert, Vote } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
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
import { FormattedDate, InitialsAvatar } from '@/components/domain/formatting';
import { DetailSection, EmptySection, Facts } from '@/components/domain/section';
import { MatchStatusPill } from '@/components/domain/status';
import { ApiErrorState } from '@/components/states/api-error-state';
import { DemoModeBanner } from '@/components/states/demo-mode-banner';
import { RefreshButton } from '@/components/tournaments/refresh-button';
import { ResultSourceBadge } from '@/components/tournaments/status-badges';
import { VetoBoard } from '@/components/tournaments/veto-board';
import { getDemoMode, getMatch, getMatchVeto, getMe } from '@/lib/api/server';
import { sampleActionsAllowed } from '@/lib/demo-mode';
import type { MatchDetailM3, MatchTeamRefM3 } from '@/lib/api/types';
import { isSuperAdmin } from '@/lib/auth/roles';
import { operatedTeamIds } from '@/lib/tournaments/access';
import { winnerSide } from '@/lib/tournaments/bracket';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ id: string }> };

function teamLabel(team: MatchTeamRefM3 | null, tbd: string): string {
  return team ? team.name : tbd;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [result, t] = await Promise.all([getMatch(id), getTranslations('matches')]);
  if (!result.ok) return { title: t('title'), robots: { index: false } };
  const m = result.data;
  return {
    title: `${teamLabel(m.teamA, t('tbd'))} ${t('vs')} ${teamLabel(m.teamB, t('tbd'))}`,
    description: m.tournament?.name ?? t('description'),
    ...(m.isSample ? { robots: { index: false } } : {}),
  };
}

function TeamCard({
  team,
  isWinner,
  tbd,
  winnerLabel,
}: {
  team: MatchTeamRefM3 | null;
  isWinner: boolean;
  tbd: string;
  winnerLabel: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center gap-2 text-center',
        isWinner && 'text-foreground',
      )}
    >
      <InitialsAvatar label={team?.name ?? '?'} size="lg" square />
      {team ? (
        <Link
          href={`/teams/${encodeURIComponent(team.slug)}`}
          className="max-w-full truncate text-lg font-bold hover:text-accent-text"
        >
          {team.name}
        </Link>
      ) : (
        <span className="text-lg font-bold text-muted">{tbd}</span>
      )}
      {team ? <span className="font-mono text-xs text-muted">{team.tag}</span> : null}
      {isWinner ? (
        <span className="text-xs font-semibold uppercase tracking-wider text-success">
          {winnerLabel}
        </span>
      ) : null}
    </div>
  );
}

/** Scores are null for maps not played (PENDING/CANCELLED) — show a dash, never 0. */
function Score({ value }: { value: number | null }) {
  return value === null ? <span className="text-muted">–</span> : <span>{value}</span>;
}

/** Series score, or a dash when no result exists (forfeits have no scores). */
function SeriesScore({ match, label, vs }: { match: MatchDetailM3; label: string; vs: string }) {
  if (match.teamAScore === null || match.teamBScore === null) {
    return (
      <span aria-hidden="true" className="text-sm font-semibold uppercase text-muted">
        {vs}
      </span>
    );
  }
  return (
    <span
      className="font-mono text-3xl font-bold tabular-nums"
      aria-label={label}
      data-testid="series-score"
    >
      {match.teamAScore}
      <span className="mx-1 text-muted">:</span>
      {match.teamBScore}
    </span>
  );
}

/** Explains where the result came from (M3: never server-verified). */
async function ResultNote({ match }: { match: MatchDetailM3 }) {
  const t = await getTranslations('matches');
  const side = winnerSide(match);
  if (match.resultSource === 'ADMIN_OVERRIDE') {
    return (
      <p
        role="note"
        data-testid="result-note"
        className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
      >
        <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        {t('adminResultNote')}
      </p>
    );
  }
  if (match.resultSource === 'FORFEIT') {
    const loser = side === 'A' ? match.teamB : side === 'B' ? match.teamA : null;
    return (
      <p
        role="note"
        data-testid="result-note"
        className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm"
      >
        {loser ? t('forfeitNote', { team: loser.name }) : t('forfeitNoteUnknown')}
      </p>
    );
  }
  if (match.status === 'CANCELLED' && match.statusReason === 'tournament_cancelled') {
    return (
      <p role="note" className="rounded-md border border-border bg-raised p-3 text-sm text-muted">
        {t('tournamentCancelledNote')}
      </p>
    );
  }
  if (match.status === 'CANCELLED' && match.statusReason === 'bye') {
    return (
      <p role="note" className="rounded-md border border-border bg-raised p-3 text-sm text-muted">
        {t('byeNote')}
      </p>
    );
  }
  return null;
}

export default async function MatchPage({ params }: Props) {
  const { id } = await params;
  const [result, t, tv] = await Promise.all([
    getMatch(id),
    getTranslations('matches'),
    getTranslations('veto'),
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

  const match = result.data;
  const maps = [...match.maps].sort((a, b) => a.mapOrder - b.mapOrder);
  const side = winnerSide(match);
  const isBye = match.status === 'CANCELLED' && match.statusReason === 'bye';
  const veto = match.tournament && !isBye ? await getMatchVeto(match.id) : null;
  const matchOpen = match.status === 'CREATED' && match.teamA !== null && match.teamB !== null;
  const vetoActive =
    veto !== null && veto.ok && veto.data.pool.length > 0 && !veto.data.complete && matchOpen;
  const me = vetoActive ? await getMe() : null;
  const operated = me && me.ok && !match.isSample ? [...operatedTeamIds(me.data)] : [];
  // SUPER_ADMIN may veto for the acting team as an audited override (labelled in the board).
  // Sample matches only in dev-only demo mode (sample captains cannot sign in).
  const demoMode = match.isSample ? await getDemoMode() : false;
  const canOverride = Boolean(
    me && me.ok && isSuperAdmin(me.data.roles) && sampleActionsAllowed(match.isSample, demoMode),
  );
  const showDemoBanner = demoMode && canOverride;
  const nameA = teamLabel(match.teamA, t('tbd'));
  const nameB = teamLabel(match.teamB, t('tbd'));

  return (
    <Container className="space-y-8 py-8">
      <h1 className="sr-only">
        {nameA} {t('vs')} {nameB}
      </h1>
      {showDemoBanner ? <DemoModeBanner /> : null}
      <Card>
        <CardContent className="space-y-6 p-5">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <MatchStatusPill status={match.status} />
            <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-xs">
              {match.format}
            </span>
            <ResultSourceBadge
              source={match.resultSource ?? null}
              verifiedAt={match.resultVerifiedAt}
            />
            {match.isSample ? <SampleDataBadge /> : null}
          </div>
          <div className="flex items-center gap-4">
            <TeamCard
              team={match.teamA}
              isWinner={side === 'A'}
              tbd={t('tbd')}
              winnerLabel={t('winner')}
            />
            <SeriesScore
              match={match}
              vs={t('vs')}
              label={t('seriesScoreLabel', {
                teamA: nameA,
                scoreA: match.teamAScore ?? 0,
                teamB: nameB,
                scoreB: match.teamBScore ?? 0,
              })}
            />
            <TeamCard
              team={match.teamB}
              isWinner={side === 'B'}
              tbd={t('tbd')}
              winnerLabel={t('winner')}
            />
          </div>
          <ResultNote match={match} />
          <div className="border-t border-border pt-4">
            <Facts
              items={[
                {
                  label: t('scheduled'),
                  value: <FormattedDate value={match.scheduledAt} withTime />,
                },
                {
                  label: t('tournament'),
                  value: match.tournament ? (
                    <Link
                      href={`/tournaments/${encodeURIComponent(match.tournament.slug)}`}
                      className="hover:text-accent-text hover:underline"
                    >
                      {match.tournament.name}
                    </Link>
                  ) : (
                    <span className="text-muted">{t('standalone')}</span>
                  ),
                },
                {
                  label: t('round'),
                  value: match.round ? (
                    t('roundNumber', { round: match.round.roundNumber })
                  ) : (
                    <span className="text-muted">—</span>
                  ),
                },
                {
                  label: t('openMatchroom'),
                  value: (
                    <Link
                      href={`/matchroom/${encodeURIComponent(match.id)}`}
                      className={buttonVariants({ variant: 'link' })}
                    >
                      {t('openMatchroom')}
                    </Link>
                  ),
                },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {veto ? (
        <DetailSection id="veto" title={tv('title')}>
          {veto.ok && veto.data.pool.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted">{tv('noLiveUpdates')}</p>
                {!veto.data.complete ? <RefreshButton label={tv('refresh')} /> : null}
              </div>
              <VetoBoard
                matchId={match.id}
                format={match.format}
                teamA={match.teamA}
                teamB={match.teamB}
                state={veto.data}
                operatedTeamIds={operated}
                canOverride={canOverride}
                matchOpen={matchOpen}
              />
            </>
          ) : veto.ok || veto.kind === 'not_found' ? (
            <EmptyState compact headingLevel="h3" icon={Vote} title={tv('notAvailable')} />
          ) : (
            <ApiErrorState failure={veto} headingLevel="h3" />
          )}
        </DetailSection>
      ) : null}

      <DetailSection id="maps" title={t('maps')}>
        {maps.length === 0 ? (
          <EmptyState compact headingLevel="h3" icon={MapIcon} title={t('mapsEmpty')} />
        ) : (
          <Table>
            <TableCaption srOnly>{t('mapsCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">{t('mapNumber')}</TableHead>
                <TableHead>{t('map')}</TableHead>
                <TableHead className="text-right">{nameA}</TableHead>
                <TableHead className="text-right">{nameB}</TableHead>
                <TableHead>{t('mapStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {maps.map((map) => (
                <TableRow key={map.mapOrder}>
                  <TableCell className="text-muted">{map.mapOrder}</TableCell>
                  <TableCell className="font-mono font-medium">{map.mapName}</TableCell>
                  <TableCell className="text-right font-semibold">
                    <Score value={map.teamAScore} />
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    <Score value={map.teamBScore} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted">{map.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DetailSection>

      <EmptySection id="stats" title={t('stats')} message={t('statsEmpty')} icon={BarChart3} />
    </Container>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BarChart3, Map as MapIcon } from 'lucide-react';
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
import { getMatch } from '@/lib/api/server';
import type { TeamRef } from '@/lib/api/types';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ id: string }> };

function teamLabel(team: TeamRef | null, tbd: string): string {
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
  team: TeamRef | null;
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

export default async function MatchPage({ params }: Props) {
  const { id } = await params;
  const [result, t] = await Promise.all([getMatch(id), getTranslations('matches')]);

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
  const winA = match.winnerTeamSlug !== null && match.winnerTeamSlug === match.teamA?.slug;
  const winB = match.winnerTeamSlug !== null && match.winnerTeamSlug === match.teamB?.slug;

  return (
    <Container className="space-y-8 py-8">
      <h1 className="sr-only">
        {teamLabel(match.teamA, t('tbd'))} {t('vs')} {teamLabel(match.teamB, t('tbd'))}
      </h1>
      <Card>
        <CardContent className="space-y-6 p-5">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <MatchStatusPill status={match.status} />
            <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-xs">
              {match.format}
            </span>
            {match.isSample ? <SampleDataBadge /> : null}
          </div>
          <div className="flex items-center gap-4">
            <TeamCard team={match.teamA} isWinner={winA} tbd={t('tbd')} winnerLabel={t('winner')} />
            <span aria-hidden="true" className="text-sm font-semibold uppercase text-muted">
              {t('vs')}
            </span>
            <TeamCard team={match.teamB} isWinner={winB} tbd={t('tbd')} winnerLabel={t('winner')} />
          </div>
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
                { label: t('format'), value: match.format },
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
                <TableHead className="text-right">{teamLabel(match.teamA, t('tbd'))}</TableHead>
                <TableHead className="text-right">{teamLabel(match.teamB, t('tbd'))}</TableHead>
                <TableHead>{t('mapStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {maps.map((map) => (
                <TableRow key={map.mapOrder}>
                  <TableCell className="text-muted">{map.mapOrder}</TableCell>
                  <TableCell className="font-medium">{map.mapName}</TableCell>
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

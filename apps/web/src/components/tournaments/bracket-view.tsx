import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { MatchStatusPill } from '@/components/domain/status';
import { SampleDataBadge } from '@/components/ui/sample-data-badge';
import type { BracketDto, BracketMatchDto, MatchTeamRefM3 } from '@/lib/api/types';
import { isByeMatch, roundLabel, winnerSide, type RoundLabel } from '@/lib/tournaments/bracket';
import { cn } from '@/lib/utils';
import { ResultSourceBadge } from './status-badges';

import { UUID_PATTERN_CLIENT as UUID } from '@/lib/tournaments/slug';

function useRoundName() {
  const t = useTranslations('bracket');
  return (label: RoundLabel) =>
    label.key === 'roundOf'
      ? t('roundOf', { teams: label.teams, fraction: label.teams / 2 })
      : t(label.key);
}

/**
 * Single-elimination bracket (docs/TOURNAMENTS.md §6) as an accessible list of rounds, each a
 * list of matches — not a canvas. Rounds are columns on large screens and stack on small ones.
 * Shows TBD slots, byes, winners and the "Admin result" flag; nothing is inferred client-side.
 */
export function BracketView({
  bracket,
  headingLevel = 'h3',
}: {
  bracket: BracketDto;
  headingLevel?: 'h3' | 'h4';
}) {
  const t = useTranslations('bracket');
  const name = useRoundName();
  const rounds = [...bracket.rounds].sort((a, b) => a.roundNumber - b.roundNumber);
  const total = rounds.length;
  const Heading = headingLevel;

  return (
    <div className="overflow-x-auto pb-2" data-testid="bracket">
      <ol
        aria-label={t('roundsLabel', { size: bracket.size })}
        className="grid gap-6 lg:grid-flow-col lg:auto-cols-[minmax(15rem,1fr)]"
      >
        {rounds.map((round) => {
          const headingId = `bracket-round-${round.roundNumber}`;
          const matches = [...round.matches].sort((a, b) => a.slotNumber - b.slotNumber);
          return (
            <li key={round.roundNumber} aria-labelledby={headingId} className="flex flex-col gap-3">
              <Heading
                id={headingId}
                className="flex items-baseline justify-between gap-2 border-b border-border pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted"
              >
                <span>{name(roundLabel(round.roundNumber, total))}</span>
                <span className="font-normal normal-case tracking-normal">
                  {t('matchCount', { count: matches.length })}
                </span>
              </Heading>
              <ol className="flex flex-1 flex-col gap-3 lg:justify-around">
                {matches.map((match) => (
                  <li key={match.id}>
                    <BracketMatchCard match={match} />
                  </li>
                ))}
              </ol>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TeamLine({
  team,
  seed,
  score,
  isWinner,
  decided,
}: {
  team: MatchTeamRefM3 | null;
  seed: number | null;
  score: number | null;
  isWinner: boolean;
  decided: boolean;
}) {
  const t = useTranslations('bracket');
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-sm',
        isWinner && 'bg-accent/10',
        decided && !isWinner && team && 'text-muted',
      )}
    >
      <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted">
        {seed !== null ? seed : ''}
        {seed !== null ? <span className="sr-only"> {t('seedSr')}</span> : null}
      </span>
      <span
        className={cn('min-w-0 flex-1 truncate', isWinner ? 'font-semibold' : 'font-medium')}
        title={team?.name}
      >
        {team ? team.name : <span className="italic text-muted">{t('tbd')}</span>}
      </span>
      {isWinner ? (
        <span className="inline-flex items-center text-accent-text">
          <Check aria-hidden="true" className="size-3.5" />
          <span className="sr-only">{t('winner')}</span>
        </span>
      ) : null}
      <span className="w-4 shrink-0 text-right font-mono text-sm tabular-nums">
        {score !== null ? score : <span className="text-muted">–</span>}
      </span>
    </div>
  );
}

export function BracketMatchCard({ match }: { match: BracketMatchDto }) {
  const t = useTranslations('bracket');
  const tm = useTranslations('matches');

  if (isByeMatch(match)) {
    const advancing = match.teamA ?? match.teamB;
    return (
      <div
        data-testid="bracket-bye"
        className="rounded-md border border-dashed border-border bg-surface/50 px-3 py-2 text-sm text-muted"
      >
        <span className="mr-2 rounded-sm border border-border px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          {t('bye')}
        </span>
        {advancing ? t('byeAdvances', { team: advancing.name }) : t('byeEmpty')}
      </div>
    );
  }

  const side = winnerSide(match);
  const decided = side !== null;
  const forfeit = match.resultSource === 'FORFEIT';
  const label = `${match.teamA?.name ?? tm('tbd')} ${tm('vs')} ${match.teamB?.name ?? tm('tbd')}`;

  return (
    <article
      aria-label={label}
      data-testid="bracket-match"
      data-result-source={match.resultSource ?? undefined}
      className="overflow-hidden rounded-md border border-border bg-surface shadow-sm"
    >
      <div className="divide-y divide-border">
        <TeamLine
          team={match.teamA}
          seed={match.teamASeed}
          score={forfeit ? null : match.teamAScore}
          isWinner={side === 'A'}
          decided={decided}
        />
        <TeamLine
          team={match.teamB}
          seed={match.teamBSeed}
          score={forfeit ? null : match.teamBScore}
          isWinner={side === 'B'}
          decided={decided}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-raised/40 px-3 py-1.5">
        {match.resultSource ? (
          <ResultSourceBadge source={match.resultSource} compact />
        ) : (
          <MatchStatusPill status={match.status} />
        )}
        <span className="font-mono text-[11px] text-muted">{match.format}</span>
        {match.isSample ? <SampleDataBadge /> : null}
        {UUID.test(match.id) ? (
          <Link
            href={`/matches/${encodeURIComponent(match.id)}`}
            className="ml-auto text-xs font-medium text-accent-text hover:underline"
          >
            {t('details')}
            <span className="sr-only">: {label}</span>
          </Link>
        ) : null}
      </div>
    </article>
  );
}

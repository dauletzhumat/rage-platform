import Link from 'next/link';
import { useTranslations } from 'next-intl';
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
import type {
  MatchSummary,
  PlayerSummary,
  TeamRef,
  TeamSummary,
  TournamentSummary,
} from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { Country, FormattedDate, InitialsAvatar } from './formatting';
import { MatchStatusPill, TournamentStatusPill } from './status';

const linkClass =
  'font-medium text-foreground hover:text-accent-text hover:underline underline-offset-4';

export function PlayersTable({ items, caption }: { items: PlayerSummary[]; caption: string }) {
  const t = useTranslations('players');
  return (
    <Table stickyHeader>
      <TableCaption>{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{t('player')}</TableHead>
          <TableHead>{t('country')}</TableHead>
          <TableHead className="hidden sm:table-cell">{t('steamId')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((player) => (
          <TableRow key={player.id}>
            <TableCell>
              <div className="flex items-center gap-2">
                <InitialsAvatar label={player.nickname} size="sm" />
                <Link href={`/players/${encodeURIComponent(player.slug)}`} className={linkClass}>
                  {player.nickname}
                </Link>
                {player.isSample ? <SampleDataBadge /> : null}
              </div>
            </TableCell>
            <TableCell>
              <Country code={player.countryCode} />
            </TableCell>
            <TableCell className="hidden font-mono text-xs text-muted sm:table-cell">
              {player.steamId64}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TeamsTable({ items, caption }: { items: TeamSummary[]; caption: string }) {
  const t = useTranslations('teams');
  return (
    <Table stickyHeader>
      <TableCaption>{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{t('team')}</TableHead>
          <TableHead>{t('tag')}</TableHead>
          <TableHead>{t('country')}</TableHead>
          <TableHead className="hidden md:table-cell">{t('region')}</TableHead>
          <TableHead className="text-right">{t('players')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((team) => (
          <TableRow key={team.id}>
            <TableCell>
              <div className="flex items-center gap-2">
                <InitialsAvatar label={team.name} size="sm" square />
                <Link href={`/teams/${encodeURIComponent(team.slug)}`} className={linkClass}>
                  {team.name}
                </Link>
                {team.isSample ? <SampleDataBadge /> : null}
              </div>
            </TableCell>
            <TableCell className="font-mono text-xs">{team.tag}</TableCell>
            <TableCell>
              <Country code={team.countryCode} />
            </TableCell>
            <TableCell className="hidden text-muted md:table-cell">{team.region ?? '—'}</TableCell>
            <TableCell className="text-right">{team.activeMemberCount}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TournamentsTable({
  items,
  caption,
}: {
  items: TournamentSummary[];
  caption: string;
}) {
  const t = useTranslations('tournaments');
  return (
    <Table stickyHeader>
      <TableCaption>{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{t('tournament')}</TableHead>
          <TableHead>{t('status')}</TableHead>
          <TableHead className="hidden sm:table-cell">{t('format')}</TableHead>
          <TableHead className="hidden md:table-cell">{t('startsAt')}</TableHead>
          <TableHead className="hidden lg:table-cell">{t('registration')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((tournament) => (
          <TableRow key={tournament.id}>
            <TableCell>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/tournaments/${encodeURIComponent(tournament.slug)}`}
                  className={linkClass}
                >
                  {tournament.name}
                </Link>
                {tournament.isSample ? <SampleDataBadge /> : null}
              </div>
            </TableCell>
            <TableCell>
              <TournamentStatusPill status={tournament.status} />
            </TableCell>
            <TableCell className="hidden text-muted sm:table-cell">{tournament.format}</TableCell>
            <TableCell className="hidden md:table-cell">
              <FormattedDate value={tournament.startsAt} withTime />
            </TableCell>
            <TableCell className="hidden text-muted lg:table-cell">
              {tournament.registrationOpenAt || tournament.registrationCloseAt ? (
                <span className="inline-flex gap-1">
                  <FormattedDate value={tournament.registrationOpenAt} />
                  <span aria-hidden="true">–</span>
                  <FormattedDate value={tournament.registrationCloseAt} />
                </span>
              ) : (
                t('tbd')
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TeamSide({
  team,
  winner,
  align,
}: {
  team: TeamRef | null;
  winner: string | null;
  align?: 'right';
}) {
  const t = useTranslations('matches');
  if (!team) return <span className="text-muted">{t('tbd')}</span>;
  const isWinner = winner !== null && winner === team.slug;
  return (
    <Link
      href={`/teams/${encodeURIComponent(team.slug)}`}
      className={cn(
        linkClass,
        'truncate',
        isWinner ? 'font-bold' : 'font-medium',
        align === 'right' && 'text-right',
      )}
    >
      {team.name}
      {isWinner ? <span className="sr-only"> ({t('winner')})</span> : null}
    </Link>
  );
}

export function MatchesTable({ items, caption }: { items: MatchSummary[]; caption: string }) {
  const t = useTranslations('matches');
  return (
    <Table stickyHeader>
      <TableCaption>{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="hidden sm:table-cell">{t('scheduled')}</TableHead>
          <TableHead>{t('teams')}</TableHead>
          <TableHead>{t('status')}</TableHead>
          <TableHead className="hidden md:table-cell">{t('format')}</TableHead>
          <TableHead className="hidden lg:table-cell">{t('tournament')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('details')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((match) => (
          <TableRow key={match.id}>
            <TableCell className="hidden whitespace-nowrap text-muted sm:table-cell">
              <FormattedDate value={match.scheduledAt} withTime />
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-1.5">
                <TeamSide team={match.teamA} winner={match.winnerTeamSlug} />
                <span className="text-xs text-muted">{t('vs')}</span>
                <TeamSide team={match.teamB} winner={match.winnerTeamSlug} />
                {match.isSample ? <SampleDataBadge /> : null}
              </div>
            </TableCell>
            <TableCell>
              <MatchStatusPill status={match.status} />
            </TableCell>
            <TableCell className="hidden font-mono text-xs md:table-cell">{match.format}</TableCell>
            <TableCell className="hidden lg:table-cell">
              {match.tournament ? (
                <Link
                  href={`/tournaments/${encodeURIComponent(match.tournament.slug)}`}
                  className="text-muted hover:text-foreground"
                >
                  {match.tournament.name}
                </Link>
              ) : (
                <span className="text-muted">{t('standalone')}</span>
              )}
            </TableCell>
            <TableCell className="text-right">
              <Link
                href={`/matches/${encodeURIComponent(match.id)}`}
                className="text-xs font-medium text-accent-text hover:underline"
              >
                {t('details')}
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

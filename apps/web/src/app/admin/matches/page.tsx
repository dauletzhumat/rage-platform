import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Swords } from 'lucide-react';
import { ListPagination } from '@/components/domain/list-controls';
import { MatchStatusPill } from '@/components/domain/status';
import { ApiErrorState } from '@/components/states/api-error-state';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { ForfeitDialog, ResultOverrideDialog } from '@/components/tournaments/match-admin-dialogs';
import { ResultSourceBadge } from '@/components/tournaments/status-badges';
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
import { getAdminMatches, getMe, getTournaments, UUID_PATTERN } from '@/lib/api/server';
import type { MatchSummaryM3, SeriesMatchStatus } from '@/lib/api/types';
import { listHref, parseListParams, totalPages, type RawSearchParams } from '@/lib/list-params';
import { hasTournamentOrMatchRole } from '@/lib/tournaments/access';
import { winnerSide } from '@/lib/tournaments/bracket';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin');
  return { title: `${t('matches')} · ${t('title')}` };
}

const PATH = '/admin/matches';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Status filter tabs: matches awaiting a result first (default), then all. */
const FILTERS = ['CREATED', 'COMPLETED', 'ALL'] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Result administration (docs/TOURNAMENTS.md §9, §13) via `GET /admin/matches`, which returns the
 * matches the viewer may administer (scoped grants see theirs). In M3 a result can only be an
 * audited admin override or forfeit; it is never shown as server-verified.
 */
export default async function AdminMatchesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const [me, raw, t, tm, ts] = await Promise.all([
    getMe(),
    searchParams,
    getTranslations('admin'),
    getTranslations('adminMatches'),
    getTranslations('matchStatus'),
  ]);
  if (!me.ok) return null;

  if (!hasTournamentOrMatchRole(me.data.roles)) {
    return (
      <div className="space-y-6 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('matches')}</h1>
        <ForbiddenState title={tm('forbiddenTitle')} description={tm('forbiddenDescription')} />
      </div>
    );
  }

  const { page, pageSize } = parseListParams(raw);
  const rawTournament = first(raw.tournamentId);
  const tournamentId =
    rawTournament && UUID_PATTERN.test(rawTournament) ? rawTournament : undefined;
  const rawFilter = first(raw.status);
  const filter: Filter = (FILTERS as readonly string[]).includes(rawFilter ?? '')
    ? (rawFilter as Filter)
    : 'CREATED';
  const status: SeriesMatchStatus | undefined = filter === 'ALL' ? undefined : filter;

  // Tournament tabs come from the public in-progress list (no admin scope needed to read it).
  const [tournaments, result] = await Promise.all([
    getTournaments({ status: 'IN_PROGRESS', page: 1, pageSize: 100 }),
    getAdminMatches({ tournamentId, status, page, pageSize }),
  ]);
  const list = tournaments.ok ? tournaments.data.items : [];
  const params = (next: { tournamentId?: string | undefined; status?: Filter }) => {
    const s = next.status ?? filter;
    return {
      tournamentId: 'tournamentId' in next ? next.tournamentId : tournamentId,
      status: s === 'CREATED' ? undefined : s,
    };
  };

  const tabClass = (active: boolean) =>
    cn(
      '-mb-px inline-flex h-9 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
      active
        ? 'border-accent text-foreground'
        : 'border-transparent text-muted hover:text-foreground',
    );

  return (
    <div className="space-y-6 px-4 py-8 sm:px-6">
      <PageHeader title={t('matches')} description={tm('description')} />

      <p
        role="note"
        className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
        data-testid="admin-result-warning"
      >
        {tm('pageWarning')}
      </p>

      {list.length > 0 ? (
        <nav aria-label={tm('tournamentPicker')} className="overflow-x-auto">
          <ul className="inline-flex min-w-full gap-1 border-b border-border">
            <li>
              <Link
                href={listHref(PATH, params({ tournamentId: undefined }))}
                aria-current={tournamentId === undefined ? 'page' : undefined}
                className={tabClass(tournamentId === undefined)}
              >
                {tm('allTournaments')}
              </Link>
            </li>
            {list.map((x) => (
              <li key={x.id}>
                <Link
                  href={listHref(PATH, params({ tournamentId: x.id }))}
                  aria-current={x.id === tournamentId ? 'page' : undefined}
                  className={tabClass(x.id === tournamentId)}
                >
                  {x.name}
                  {x.isSample ? <SampleDataBadge /> : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <nav aria-label={tm('statusFilter')}>
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <li key={f}>
              <Link
                href={listHref(PATH, params({ status: f }))}
                aria-current={f === filter ? 'page' : undefined}
                className={cn(
                  'inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors',
                  f === filter
                    ? 'border-accent bg-accent/10 text-foreground'
                    : 'border-border text-muted hover:border-border-strong hover:text-foreground',
                )}
              >
                {f === 'ALL' ? tm('allStatuses') : f === 'CREATED' ? tm('awaitingResult') : ts(f)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {!result.ok ? (
        <ApiErrorState failure={result} />
      ) : result.data.items.length === 0 ? (
        <EmptyState icon={Swords} title={tm('noMatches')} description={tm('noTournamentsHint')} />
      ) : (
        <div>
          <MatchesTable
            matches={result.data.items}
            caption={tm('captionPaged', {
              page,
              totalPages: totalPages(result.data.total, result.data.pageSize),
            })}
          />
          <ListPagination
            pathname={PATH}
            page={page}
            pageSize={result.data.pageSize}
            total={result.data.total}
            params={params({})}
          />
        </div>
      )}
    </div>
  );
}

async function MatchesTable({ matches, caption }: { matches: MatchSummaryM3[]; caption: string }) {
  const [tm, tmatch] = await Promise.all([
    getTranslations('adminMatches'),
    getTranslations('matches'),
  ]);
  return (
    <Table>
      <TableCaption>{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{tm('colMatch')}</TableHead>
          <TableHead className="hidden md:table-cell">{tm('colRound')}</TableHead>
          <TableHead>{tm('colStatus')}</TableHead>
          <TableHead className="hidden sm:table-cell">{tm('colResult')}</TableHead>
          <TableHead>
            <span className="sr-only">{tm('colActions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {matches.map((match) => {
          const side = winnerSide(match);
          // The list contains only matches the viewer may administer; the API re-authorises.
          const actionable =
            match.status === 'CREATED' &&
            match.teamA !== null &&
            match.teamB !== null &&
            !match.isSample;
          return (
            <TableRow key={match.id}>
              <TableCell className="align-top">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className={side === 'A' ? 'font-semibold' : undefined}>
                    {match.teamA?.name ?? tmatch('tbd')}
                  </span>
                  <span className="text-xs text-muted">{tmatch('vs')}</span>
                  <span className={side === 'B' ? 'font-semibold' : undefined}>
                    {match.teamB?.name ?? tmatch('tbd')}
                  </span>
                  <span className="font-mono text-[11px] text-muted">{match.format}</span>
                  {match.isSample ? <SampleDataBadge /> : null}
                </div>
                <div className="flex flex-wrap gap-x-3 text-xs">
                  {match.tournament ? (
                    <span className="text-muted">{match.tournament.name}</span>
                  ) : null}
                  {UUID_PATTERN.test(match.id) ? (
                    <Link
                      href={`/matches/${encodeURIComponent(match.id)}`}
                      className="text-accent-text hover:underline"
                    >
                      {tmatch('details')}
                    </Link>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="hidden whitespace-nowrap align-top text-xs text-muted md:table-cell">
                {match.round ? tmatch('roundNumber', { round: match.round.roundNumber }) : '—'}
              </TableCell>
              <TableCell className="align-top">
                <MatchStatusPill status={match.status} />
              </TableCell>
              <TableCell className="hidden align-top sm:table-cell">
                <div className="flex flex-wrap items-center gap-1.5">
                  {match.teamAScore !== null && match.teamBScore !== null ? (
                    <span className="font-mono text-sm tabular-nums">
                      {match.teamAScore}:{match.teamBScore}
                    </span>
                  ) : null}
                  <ResultSourceBadge
                    source={match.resultSource}
                    verifiedAt={match.resultVerifiedAt}
                    compact
                  />
                </div>
              </TableCell>
              <TableCell className="align-top">
                {actionable && match.teamA && match.teamB ? (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <ResultOverrideDialog
                      matchId={match.id}
                      format={match.format}
                      teamA={match.teamA}
                      teamB={match.teamB}
                    />
                    <ForfeitDialog
                      matchId={match.id}
                      format={match.format}
                      teamA={match.teamA}
                      teamB={match.teamB}
                    />
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

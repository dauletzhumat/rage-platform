import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Plus, Trophy } from 'lucide-react';
import { FormattedDate } from '@/components/domain/formatting';
import { ListPagination, SearchForm } from '@/components/domain/list-controls';
import { TournamentStatusPill } from '@/components/domain/status';
import { ApiErrorState } from '@/components/states/api-error-state';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { buttonVariants } from '@/components/ui/button';
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
import { getAdminTournaments, getMe, UUID_PATTERN } from '@/lib/api/server';
import { TOURNAMENT_STATUSES, type TournamentStatus } from '@/lib/api/types';
import {
  listHref,
  parseListParams,
  pickParam,
  totalPages,
  type RawSearchParams,
} from '@/lib/list-params';
import { canCreateTournament, hasTournamentOrMatchRole } from '@/lib/tournaments/access';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin');
  return { title: `${t('tournaments')} · ${t('title')}` };
}

const PATH = '/admin/tournaments';

/** Tournament admin list incl. DRAFT (docs/TOURNAMENTS.md §10, §13). */
export default async function AdminTournamentsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const [me, t, ta, ts] = await Promise.all([
    getMe(),
    getTranslations('admin'),
    getTranslations('adminTournaments'),
    getTranslations('tournamentStatus'),
  ]);
  if (!me.ok) return null; // the layout already rendered the appropriate state

  if (!hasTournamentOrMatchRole(me.data.roles)) {
    return (
      <div className="space-y-6 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('tournaments')}</h1>
        <ForbiddenState title={ta('forbiddenTitle')} description={ta('forbiddenDescription')} />
      </div>
    );
  }

  const raw = await searchParams;
  const { page, pageSize, q } = parseListParams(raw);
  const status = pickParam<TournamentStatus>(raw, 'status', TOURNAMENT_STATUSES);
  const result = await getAdminTournaments({ status, q, page, pageSize });
  const canCreate = canCreateTournament(me.data.roles);

  const filters: Array<{ value: TournamentStatus | undefined; label: string }> = [
    { value: undefined, label: ta('allStatuses') },
    ...TOURNAMENT_STATUSES.map((s) => ({ value: s, label: ts(s) })),
  ];

  return (
    <div className="space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        title={t('tournaments')}
        description={ta('description')}
        actions={
          canCreate ? (
            <Link
              href={`${PATH}/new`}
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
              data-testid="create-tournament-link"
            >
              <Plus aria-hidden="true" />
              {ta('createTournament')}
            </Link>
          ) : null
        }
      />

      <div className="flex flex-col gap-4">
        <SearchForm action={PATH} label={ta('searchLabel')} q={q} hidden={{ status }} />
        <nav aria-label={ta('filterLabel')} className="overflow-x-auto">
          <ul className="inline-flex min-w-full gap-1 border-b border-border">
            {filters.map((filter) => {
              const active = filter.value === status;
              return (
                <li key={filter.value ?? 'all'}>
                  <Link
                    href={listHref(PATH, { q, status: filter.value })}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      '-mb-px inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
                      active
                        ? 'border-accent text-foreground'
                        : 'border-transparent text-muted hover:text-foreground',
                    )}
                  >
                    {filter.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {!result.ok ? (
        <ApiErrorState failure={result} />
      ) : result.data.items.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={ta('empty')}
          description={canCreate ? ta('emptyCreateHint') : undefined}
        />
      ) : (
        <div>
          <Table stickyHeader>
            <TableCaption>
              {ta('caption', {
                page,
                totalPages: totalPages(result.data.total, result.data.pageSize),
              })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{ta('colTournament')}</TableHead>
                <TableHead>{ta('colStatus')}</TableHead>
                <TableHead className="hidden sm:table-cell">{ta('colFormat')}</TableHead>
                <TableHead className="text-right">{ta('colTeams')}</TableHead>
                <TableHead className="hidden md:table-cell">{ta('colStarts')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.items.map((tournament) => (
                <TableRow key={tournament.id}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      {UUID_PATTERN.test(tournament.id) ? (
                        <Link
                          href={`${PATH}/${encodeURIComponent(tournament.id)}`}
                          className="font-medium hover:text-accent-text hover:underline"
                        >
                          {tournament.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{tournament.name}</span>
                      )}
                      {tournament.isSample ? <SampleDataBadge /> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <TournamentStatusPill status={tournament.status} />
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs sm:table-cell">
                    {tournament.defaultMatchFormat}
                    {tournament.finalMatchFormat ? ` / ${tournament.finalMatchFormat}` : ''}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {tournament.approvedTeamCount}/{tournament.maxTeams ?? '—'}
                    {tournament.pendingRegistrationCount > 0 ? (
                      <div className="text-xs text-warning">
                        {ta('pendingCount', { count: tournament.pendingRegistrationCount })}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <FormattedDate value={tournament.startsAt} withTime />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ListPagination
            pathname={PATH}
            page={page}
            pageSize={result.data.pageSize}
            total={result.data.total}
            params={{ q, status }}
          />
        </div>
      )}
    </div>
  );
}

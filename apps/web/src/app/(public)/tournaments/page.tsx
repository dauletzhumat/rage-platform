import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { SearchX, Trophy } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ListPagination, SearchForm } from '@/components/domain/list-controls';
import { TournamentsTable } from '@/components/domain/tables';
import { ApiErrorState } from '@/components/states/api-error-state';
import { getTournaments } from '@/lib/api/server';
import { TOURNAMENT_STATUSES, type TournamentStatus } from '@/lib/api/types';
import {
  listHref,
  parseListParams,
  pickParam,
  totalPages,
  type RawSearchParams,
} from '@/lib/list-params';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tournaments');
  return { title: t('title'), description: t('description') };
}

export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const { page, pageSize, q } = parseListParams(raw);
  // DRAFT is never public; the API rejects it as a filter, so ignore it from the URL.
  const publicStatuses = TOURNAMENT_STATUSES.filter((s) => s !== 'DRAFT');
  const status = pickParam<TournamentStatus>(raw, 'status', publicStatuses);
  const [result, t, ts, tc] = await Promise.all([
    getTournaments({ page, pageSize, q, status }),
    getTranslations('tournaments'),
    getTranslations('tournamentStatus'),
    getTranslations('common'),
  ]);

  const filters: Array<{ value: TournamentStatus | undefined; label: string }> = [
    { value: undefined, label: t('allStatuses') },
    ...publicStatuses.map((s) => ({ value: s, label: ts(s) })),
  ];

  return (
    <Container className="space-y-6 py-8">
      <PageHeader title={t('title')} description={t('description')} />
      <div className="flex flex-col gap-4">
        <SearchForm action="/tournaments" label={t('searchLabel')} q={q} hidden={{ status }} />
        <nav aria-label={t('filterLabel')}>
          <ul className="flex flex-wrap gap-2">
            {filters.map((filter) => {
              const active = filter.value === status;
              return (
                <li key={filter.value ?? 'all'}>
                  <Link
                    href={listHref('/tournaments', { q, status: filter.value })}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors',
                      active
                        ? 'border-accent bg-accent/10 text-foreground'
                        : 'border-border text-muted hover:border-border-strong hover:text-foreground',
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
        q ? (
          <EmptyState
            icon={SearchX}
            title={tc('noSearchResults', { q })}
            description={tc('noSearchResultsDescription')}
          />
        ) : (
          <EmptyState icon={Trophy} title={t('empty')} description={t('emptyDescription')} />
        )
      ) : (
        <div>
          <TournamentsTable
            items={result.data.items}
            caption={t('tableCaption', {
              page,
              totalPages: totalPages(result.data.total, result.data.pageSize),
            })}
          />
          <ListPagination
            pathname="/tournaments"
            page={page}
            pageSize={result.data.pageSize}
            total={result.data.total}
            params={{ q, status }}
          />
        </div>
      )}
    </Container>
  );
}

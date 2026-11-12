import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SearchX, Swords } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ListPagination, SearchForm } from '@/components/domain/list-controls';
import { MatchesTable } from '@/components/domain/tables';
import { ApiErrorState } from '@/components/states/api-error-state';
import { getMatches } from '@/lib/api/server';
import { parseListParams, totalPages, type RawSearchParams } from '@/lib/list-params';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('matches');
  return { title: t('title'), description: t('description') };
}

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { page, pageSize, q } = parseListParams(await searchParams);
  const [result, t, tc] = await Promise.all([
    getMatches({ page, pageSize, q }),
    getTranslations('matches'),
    getTranslations('common'),
  ]);

  return (
    <Container className="space-y-6 py-8">
      <PageHeader title={t('title')} description={t('description')} />
      <SearchForm action="/matches" label={t('searchLabel')} q={q} />
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
          <EmptyState icon={Swords} title={t('empty')} description={t('emptyDescription')} />
        )
      ) : (
        <div>
          <MatchesTable
            items={result.data.items}
            caption={t('tableCaption', {
              page,
              totalPages: totalPages(result.data.total, result.data.pageSize),
            })}
          />
          <ListPagination
            pathname="/matches"
            page={page}
            pageSize={result.data.pageSize}
            total={result.data.total}
            params={{ q }}
          />
        </div>
      )}
    </Container>
  );
}

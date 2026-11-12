import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { SearchX, Shield } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ListPagination, SearchForm } from '@/components/domain/list-controls';
import { TeamsTable } from '@/components/domain/tables';
import { ApiErrorState } from '@/components/states/api-error-state';
import { getTeams } from '@/lib/api/server';
import { parseListParams, totalPages, type RawSearchParams } from '@/lib/list-params';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('teams');
  return { title: t('title'), description: t('description') };
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { page, pageSize, q } = parseListParams(await searchParams);
  const [result, t, tc] = await Promise.all([
    getTeams({ page, pageSize, q }),
    getTranslations('teams'),
    getTranslations('common'),
  ]);

  return (
    <Container className="space-y-6 py-8">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link
            href="/teams/apply"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            {t('apply')}
          </Link>
        }
      />
      <SearchForm action="/teams" label={t('searchLabel')} q={q} />
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
          <EmptyState icon={Shield} title={t('empty')} description={t('emptyDescription')} />
        )
      ) : (
        <div>
          <TeamsTable
            items={result.data.items}
            caption={t('tableCaption', {
              page,
              totalPages: totalPages(result.data.total, result.data.pageSize),
            })}
          />
          <ListPagination
            pathname="/teams"
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

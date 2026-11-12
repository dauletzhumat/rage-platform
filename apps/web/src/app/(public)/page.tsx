import { Suspense } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, Swords, Trophy } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
import { TableSkeleton } from '@/components/ui/skeleton';
import { ApiStatusCard, ApiStatusCardSkeleton } from '@/components/domain/api-status-card';
import { MatchesTable, TournamentsTable } from '@/components/domain/tables';
import { ApiErrorState } from '@/components/states/api-error-state';
import { getMatches, getTournaments } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

async function LatestTournaments() {
  const [result, t] = await Promise.all([
    getTournaments({ page: 1, pageSize: 5 }),
    getTranslations('tournaments'),
  ]);
  if (!result.ok) return <ApiErrorState failure={result} headingLevel="h3" />;
  if (result.data.items.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        headingLevel="h3"
        title={t('empty')}
        description={t('emptyDescription')}
        compact
      />
    );
  }
  return <TournamentsTable items={result.data.items} caption={t('title')} />;
}

async function LatestMatches() {
  const [result, t] = await Promise.all([
    getMatches({ page: 1, pageSize: 5 }),
    getTranslations('matches'),
  ]);
  if (!result.ok) return <ApiErrorState failure={result} headingLevel="h3" />;
  if (result.data.items.length === 0) {
    return (
      <EmptyState
        icon={Swords}
        headingLevel="h3"
        title={t('empty')}
        description={t('emptyDescription')}
        compact
      />
    );
  }
  return <MatchesTable items={result.data.items} caption={t('title')} />;
}

function SectionHeading({
  id,
  title,
  href,
  linkLabel,
}: {
  id: string;
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 id={id} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <Link
        href={href}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        {linkLabel}
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </div>
  );
}

export default async function HomePage() {
  const t = await getTranslations('home');
  const tc = await getTranslations('common');

  return (
    <>
      <section
        aria-labelledby="hero-title"
        className="relative overflow-hidden border-b border-border"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_85%_-10%,color-mix(in_srgb,var(--color-accent)_22%,transparent),transparent_70%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(var(--color-foreground)_1px,transparent_1px),linear-gradient(90deg,var(--color-foreground)_1px,transparent_1px)] [background-size:48px_48px]"
        />
        <Container className="relative grid gap-10 py-14 lg:grid-cols-[1.4fr_1fr] lg:items-center lg:py-20">
          <div className="space-y-5">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent-text">
              {t('eyebrow')}
            </p>
            <h1
              id="hero-title"
              className="text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl"
            >
              {t('heroTitle')}
            </h1>
            <p className="max-w-xl text-base text-muted sm:text-lg">{t('heroSubtitle')}</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/tournaments" className={buttonVariants({ size: 'lg' })}>
                {t('browseTournaments')}
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link href="/teams" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
                {t('browseTeams')}
              </Link>
            </div>
          </div>
          <Suspense fallback={<ApiStatusCardSkeleton />}>
            <ApiStatusCard />
          </Suspense>
        </Container>
      </section>

      <Container className="grid gap-10 py-10 xl:grid-cols-2">
        <section aria-labelledby="latest-tournaments">
          <SectionHeading
            id="latest-tournaments"
            title={t('latestTournaments')}
            href="/tournaments"
            linkLabel={tc('viewAll')}
          />
          <Suspense fallback={<TableSkeleton rows={5} />}>
            <LatestTournaments />
          </Suspense>
        </section>
        <section aria-labelledby="latest-matches">
          <SectionHeading
            id="latest-matches"
            title={t('latestMatches')}
            href="/matches"
            linkLabel={tc('viewAll')}
          />
          <Suspense fallback={<TableSkeleton rows={5} />}>
            <LatestMatches />
          </Suspense>
        </section>
      </Container>
    </>
  );
}

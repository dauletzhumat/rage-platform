import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { GitBranch, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { PageHeader } from '@/components/ui/page-header';
import { SampleDataBadge } from '@/components/ui/sample-data-badge';
import { FormattedDate } from '@/components/domain/formatting';
import { DetailSection, EmptySection, Facts } from '@/components/domain/section';
import { TournamentStatusPill } from '@/components/domain/status';
import { ApiErrorState } from '@/components/states/api-error-state';
import { getTournament } from '@/lib/api/server';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [result, t] = await Promise.all([getTournament(slug), getTranslations('tournaments')]);
  if (!result.ok) return { title: t('title'), robots: { index: false } };
  return {
    title: result.data.name,
    description: result.data.description ?? t('description'),
    ...(result.data.isSample ? { robots: { index: false } } : {}),
  };
}

export default async function TournamentPage({ params }: Props) {
  const { slug } = await params;
  const [result, t] = await Promise.all([getTournament(slug), getTranslations('tournaments')]);

  if (!result.ok) {
    if (result.kind === 'not_found') notFound();
    return (
      <Container className="py-8">
        <h1 className="sr-only">{t('title')}</h1>
        <ApiErrorState failure={result} />
      </Container>
    );
  }

  const tournament = result.data;

  return (
    <Container className="space-y-8 py-8">
      <PageHeader
        eyebrow={t('tournament')}
        title={tournament.name}
        badges={
          <>
            <TournamentStatusPill status={tournament.status} />
            {tournament.isSample ? <SampleDataBadge /> : null}
          </>
        }
      />
      <Card>
        <CardContent>
          <Facts
            items={[
              { label: t('format'), value: tournament.format },
              {
                label: t('startsAt'),
                value: <FormattedDate value={tournament.startsAt} withTime />,
              },
              {
                label: t('registrationOpens'),
                value: <FormattedDate value={tournament.registrationOpenAt} withTime />,
              },
              {
                label: t('registrationCloses'),
                value: <FormattedDate value={tournament.registrationCloseAt} withTime />,
              },
              {
                label: t('registeredTeams'),
                value: <span className="tabular">{tournament.registeredTeamCount}</span>,
              },
            ]}
          />
        </CardContent>
      </Card>

      <DetailSection id="overview" title={t('overview')}>
        <p className="max-w-3xl whitespace-pre-line text-sm text-muted">
          {tournament.description || t('noDescription')}
        </p>
      </DetailSection>

      <div className="grid gap-8 lg:grid-cols-2">
        <EmptySection
          id="bracket"
          title={t('bracket')}
          message={t('bracketEmpty')}
          icon={GitBranch}
        />
        <EmptySection
          id="participants"
          title={t('participants')}
          message={t('participantsEmpty')}
          icon={Users}
        />
      </div>
    </Container>
  );
}

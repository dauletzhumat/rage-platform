import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Award, CalendarClock, Map as MapIcon, Swords } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
import { Country, FormattedDate, InitialsAvatar } from '@/components/domain/formatting';
import { DetailSection, EmptySection, Facts } from '@/components/domain/section';
import { ApiErrorState } from '@/components/states/api-error-state';
import { getTeam } from '@/lib/api/server';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [result, t] = await Promise.all([getTeam(slug), getTranslations('teams')]);
  if (!result.ok) return { title: t('title'), robots: { index: false } };
  return {
    title: `${result.data.name} (${result.data.tag})`,
    description: result.data.description ?? t('description'),
    ...(result.data.isSample ? { robots: { index: false } } : {}),
  };
}

export default async function TeamPage({ params }: Props) {
  const { slug } = await params;
  const [result, t, tr] = await Promise.all([
    getTeam(slug),
    getTranslations('teams'),
    getTranslations('roles'),
  ]);

  if (!result.ok) {
    if (result.kind === 'not_found') notFound();
    return (
      <Container className="py-8">
        <h1 className="sr-only">{t('title')}</h1>
        <ApiErrorState failure={result} />
      </Container>
    );
  }

  const team = result.data;

  return (
    <Container className="space-y-8 py-8">
      {/* Header: identity block (logo, name, tag, country) + key facts */}
      <Card>
        <CardContent className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center">
          <InitialsAvatar label={team.name} size="lg" square />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{team.name}</h1>
              <Badge tone="outline" className="font-mono">
                {team.tag}
              </Badge>
              {team.isSample ? <SampleDataBadge /> : null}
            </div>
            <Facts
              items={[
                { label: t('country'), value: <Country code={team.countryCode} /> },
                { label: t('region'), value: team.region ?? '—' },
                { label: t('ranking'), value: <span className="text-muted">{t('unranked')}</span> },
                { label: t('founded'), value: <FormattedDate value={team.createdAt} /> },
              ]}
            />
          </div>
          <Link
            href={`/teams/${encodeURIComponent(team.slug)}/manage`}
            className="text-sm text-muted hover:text-foreground"
          >
            {t('manage')}
          </Link>
        </CardContent>
      </Card>

      {team.description ? <p className="max-w-3xl text-sm text-muted">{team.description}</p> : null}

      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-8">
          <DetailSection id="roster" title={t('roster')}>
            {team.roster.length === 0 ? (
              <EmptyState compact headingLevel="h3" title={t('rosterEmpty')} />
            ) : (
              <Table>
                <TableCaption srOnly>{t('rosterCaption', { team: team.name })}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('players')}</TableHead>
                    <TableHead>{t('role')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('country')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('joined')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.roster.map((member) => (
                    <TableRow key={`${member.playerSlug}-${member.role}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <InitialsAvatar label={member.nickname} size="sm" />
                          <Link
                            href={`/players/${encodeURIComponent(member.playerSlug)}`}
                            className="font-medium hover:text-accent-text hover:underline"
                          >
                            {member.nickname}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge tone={member.role === 'CAPTAIN' ? 'accent' : 'neutral'}>
                          {tr(member.role)}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Country code={member.countryCode} />
                      </TableCell>
                      <TableCell className="hidden text-muted sm:table-cell">
                        <FormattedDate value={member.joinedAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DetailSection>
          <EmptySection
            id="results"
            title={t('results')}
            message={t('resultsEmpty')}
            icon={Swords}
          />
          <EmptySection
            id="map-stats"
            title={t('mapStats')}
            message={t('mapStatsEmpty')}
            icon={MapIcon}
          />
        </div>
        <div className="space-y-8">
          <EmptySection
            id="upcoming"
            title={t('upcomingMatches')}
            message={t('upcomingEmpty')}
            icon={CalendarClock}
          />
          <EmptySection
            id="achievements"
            title={t('achievements')}
            message={t('achievementsEmpty')}
            icon={Award}
          />
        </div>
      </div>
    </Container>
  );
}

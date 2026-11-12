import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BarChart3, ExternalLink, History, Swords } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { SampleDataBadge } from '@/components/ui/sample-data-badge';
import { Country, FormattedDate, InitialsAvatar } from '@/components/domain/formatting';
import { DetailSection, EmptySection, Facts } from '@/components/domain/section';
import { ApiErrorState } from '@/components/states/api-error-state';
import { getPlayer } from '@/lib/api/server';
import { isIndividualSteamId64 } from '@/lib/steam-id';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [result, t] = await Promise.all([getPlayer(slug), getTranslations('players')]);
  if (!result.ok) return { title: t('title'), robots: { index: false } };
  return {
    title: result.data.nickname,
    description: result.data.biography ?? t('description'),
    ...(result.data.isSample ? { robots: { index: false } } : {}),
  };
}

export default async function PlayerPage({ params }: Props) {
  const { slug } = await params;
  const [result, t] = await Promise.all([getPlayer(slug), getTranslations('players')]);

  if (!result.ok) {
    if (result.kind === 'not_found') notFound();
    return (
      <Container className="py-8">
        <h1 className="sr-only">{t('title')}</h1>
        <ApiErrorState failure={result} />
      </Container>
    );
  }

  const player = result.data;
  // Link out only for real individual Steam accounts: never for sample data (whose
  // reserved IDs are below the individual-account base and do not exist on Steam).
  const steamUrl =
    !player.isSample && isIndividualSteamId64(player.steamId64)
      ? `https://steamcommunity.com/profiles/${player.steamId64}`
      : null;

  return (
    <Container className="space-y-8 py-8">
      <Card>
        <CardContent className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center">
          <InitialsAvatar label={player.nickname} size="lg" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{player.nickname}</h1>
              {player.isSample ? <SampleDataBadge /> : null}
            </div>
            <Facts
              items={[
                { label: t('country'), value: <Country code={player.countryCode} /> },
                {
                  label: t('currentTeam'),
                  value: player.currentTeam ? (
                    <Link
                      href={`/teams/${encodeURIComponent(player.currentTeam.slug)}`}
                      className="hover:text-accent-text hover:underline"
                    >
                      {player.currentTeam.name}
                    </Link>
                  ) : (
                    <span className="text-muted">{t('freeAgent')}</span>
                  ),
                },
                {
                  label: t('steamId'),
                  value: <span className="font-mono text-xs">{player.steamId64}</span>,
                },
                { label: t('memberSince'), value: <FormattedDate value={player.createdAt} /> },
              ]}
            />
          </div>
          {steamUrl ? (
            <a
              href={steamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
            >
              {t('steamProfile')}
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          ) : null}
        </CardContent>
      </Card>

      <DetailSection id="biography" title={t('biography')}>
        <p className="max-w-3xl text-sm text-muted">{player.biography ?? t('noBiography')}</p>
      </DetailSection>

      <div className="grid gap-8 lg:grid-cols-2">
        <EmptySection id="stats" title={t('stats')} message={t('statsEmpty')} icon={BarChart3} />
        <EmptySection
          id="recent"
          title={t('recentMatches')}
          message={t('recentMatchesEmpty')}
          icon={Swords}
        />
        <EmptySection
          id="history"
          title={t('teamHistory')}
          message={t('teamHistoryEmpty')}
          icon={History}
        />
      </div>
    </Container>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Award, CalendarClock, History, Map as MapIcon, Swords } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
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
import { getMe, getTeam, getTeamRosterHistory } from '@/lib/api/server';
import {
  ROSTER_LEFT_REASONS,
  type ApiResult,
  type MeDtoM2,
  type PaginatedResponse,
  type RosterHistoryEntryDto,
  type RosterLeftReason,
} from '@/lib/api/types';
import { isSuperAdmin } from '@/lib/auth/roles';
import { listHref, totalPages, type RawSearchParams } from '@/lib/list-params';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> };

const HISTORY_PAGE_SIZE = 10;

function parseHistoryPage(raw: string | string[] | undefined): number {
  const value = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? '1') : (raw ?? '1'), 10);
  return Number.isFinite(value) && value >= 1 && value <= 10_000 ? value : 1;
}

function isLeftReason(value: string | null): value is RosterLeftReason {
  return value !== null && (ROSTER_LEFT_REASONS as readonly string[]).includes(value);
}

/**
 * UX only — the manage endpoint authorises. Captain (from `me.membership`), SUPER_ADMIN, or a
 * TEAM_MANAGER grant scoped to this team sees the link.
 */
function canSeeManageLink(me: ApiResult<MeDtoM2>, teamId: string, teamSlug: string): boolean {
  if (!me.ok) return false;
  const { membership, roles } = me.data;
  if (membership && membership.teamSlug === teamSlug && membership.role === 'CAPTAIN') return true;
  if (isSuperAdmin(roles)) return true;
  return roles.some(
    (r) => r.role === 'TEAM_MANAGER' && r.scopeType === 'TEAM' && r.scopeId === teamId,
  );
}

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

export default async function TeamPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const historyPage = parseHistoryPage(query.historyPage);
  const [result, history, me, t, tr] = await Promise.all([
    getTeam(slug),
    getTeamRosterHistory(slug, historyPage, HISTORY_PAGE_SIZE),
    getMe(),
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
          {canSeeManageLink(me, team.id, team.slug) ? (
            <Link
              href={`/teams/${encodeURIComponent(team.slug)}/manage`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              data-testid="manage-team-link"
            >
              {t('manage')}
            </Link>
          ) : null}
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
          <RosterHistorySection
            history={history}
            page={historyPage}
            teamSlug={team.slug}
            teamName={team.name}
          />
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

async function RosterHistorySection({
  history,
  page,
  teamSlug,
  teamName,
}: {
  history: ApiResult<PaginatedResponse<RosterHistoryEntryDto>>;
  page: number;
  teamSlug: string;
  teamName: string;
}) {
  const [t, tr, tc] = await Promise.all([
    getTranslations('teams'),
    getTranslations('roles'),
    getTranslations('common'),
  ]);
  const base = `/teams/${encodeURIComponent(teamSlug)}`;
  const pageHref = (p: number) => `${listHref(base, { historyPage: p })}#roster-history`;

  if (!history.ok) {
    return (
      <DetailSection id="roster-history" title={t('rosterHistory')}>
        <ApiErrorState failure={history} headingLevel="h3" />
      </DetailSection>
    );
  }
  const pages = totalPages(history.data.total, history.data.pageSize);

  return (
    <DetailSection id="roster-history" title={t('rosterHistory')}>
      {history.data.items.length === 0 ? (
        <EmptyState compact headingLevel="h3" icon={History} title={t('rosterHistoryEmpty')} />
      ) : (
        <div>
          <Table>
            <TableCaption srOnly>
              {t('rosterHistoryCaption', { team: teamName, page, totalPages: pages })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('players')}</TableHead>
                <TableHead>{t('role')}</TableHead>
                <TableHead>{t('joined')}</TableHead>
                <TableHead>{t('left')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('leftReason')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.data.items.map((entry, index) => (
                <TableRow key={`${entry.playerSlug}-${entry.joinedAt}-${index}`}>
                  <TableCell>
                    <Link
                      href={`/players/${encodeURIComponent(entry.playerSlug)}`}
                      className="font-medium hover:text-accent-text hover:underline"
                    >
                      {entry.nickname}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge tone={entry.role === 'CAPTAIN' ? 'accent' : 'neutral'}>
                      {tr(entry.role)}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted">
                    <FormattedDate value={entry.joinedAt} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted">
                    {entry.leftAt ? (
                      <FormattedDate value={entry.leftAt} />
                    ) : (
                      <Badge tone="success">{t('current')}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted sm:table-cell">
                    {isLeftReason(entry.leftReason)
                      ? t(`leftReasons.${entry.leftReason}`)
                      : tc('notAvailable')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            className="mt-4"
            page={page}
            totalPages={pages}
            previousHref={page > 1 ? pageHref(page - 1) : null}
            nextHref={page < pages ? pageHref(page + 1) : null}
            labels={{
              nav: t('rosterHistoryPagination'),
              previous: tc('previous'),
              next: tc('next'),
              status: tc('pageOf', { page, totalPages: pages }),
            }}
          />
        </div>
      )}
    </DetailSection>
  );
}

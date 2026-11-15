import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ClipboardList, GitBranch } from 'lucide-react';
import { FormattedDate } from '@/components/domain/formatting';
import { ListPagination } from '@/components/domain/list-controls';
import { DetailSection, Facts } from '@/components/domain/section';
import { TournamentStatusPill } from '@/components/domain/status';
import { ApiErrorState } from '@/components/states/api-error-state';
import { DemoModeBanner } from '@/components/states/demo-mode-banner';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { BracketView } from '@/components/tournaments/bracket-view';
import { SeedingEditor } from '@/components/tournaments/seeding-editor';
import {
  RegistrationStatusBadge,
  RosterRoleBadge,
  RosterStatusBadge,
} from '@/components/tournaments/status-badges';
import {
  SubstituteDialog,
  type SubstitutePlayer,
} from '@/components/tournaments/substitute-dialog';
import {
  ApproveRegistrationButton,
  GenerateBracketButton,
  RejectRegistrationButton,
  TournamentStatusButton,
} from '@/components/tournaments/tournament-actions';
import { TournamentForm } from '@/components/tournaments/tournament-form';
import { MapPoolList } from '@/components/tournaments/tournament-parts';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  getAdminRegistrations,
  getAdminTournament,
  getDemoMode,
  getMe,
  getTeam,
  getTournamentBracket,
  SLUG_PATTERN,
  UUID_PATTERN,
} from '@/lib/api/server';
import {
  REGISTRATION_STATUSES,
  type AdminRegistrationDto,
  type AdminTournamentDto,
  type RegistrationStatus,
} from '@/lib/api/types';
import {
  listHref,
  parseListParams,
  pickParam,
  totalPages,
  type RawSearchParams,
} from '@/lib/list-params';
import { canEditTournament, manualStatusTargets } from '@/lib/tournaments/validation';
import { sampleActionsAllowed } from '@/lib/demo-mode';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [result, t] = await Promise.all([getAdminTournament(id), getTranslations('admin')]);
  return {
    title: result.ok
      ? `${result.data.name} · ${t('title')}`
      : `${t('tournaments')} · ${t('title')}`,
  };
}

/**
 * Tournament administration (docs/TOURNAMENTS.md §3–§6, §13): status actions, settings,
 * registrations queue (approve / reject / substitute), seeding and bracket generation.
 * The API authorises every action (tournament admin of T) and audits it.
 */
export default async function AdminTournamentPage({ params, searchParams }: Props) {
  const [{ id }, raw, me, t, ta] = await Promise.all([
    params,
    searchParams,
    getMe(),
    getTranslations('admin'),
    getTranslations('adminTournaments'),
  ]);
  if (!me.ok) return null;
  if (!UUID_PATTERN.test(id)) notFound();

  const result = await getAdminTournament(id);
  if (!result.ok) {
    if (result.kind === 'not_found') notFound();
    return (
      <div className="space-y-6 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('tournaments')}</h1>
        {result.kind === 'forbidden' ? (
          <ForbiddenState title={ta('forbiddenTitle')} description={ta('forbiddenDescription')} />
        ) : (
          <ApiErrorState failure={result} />
        )}
      </div>
    );
  }

  const tournament = result.data;
  const demoMode = await getDemoMode();
  // Sample tournaments are read-only unless dev-only demo mode allows sample mutations.
  const readOnly = !sampleActionsAllowed(tournament.isSample, demoMode);
  const showDemoBanner = demoMode && tournament.isSample;
  const targets = readOnly ? [] : manualStatusTargets(tournament.status);
  const publicHref =
    tournament.status !== 'DRAFT' && SLUG_PATTERN.test(tournament.slug)
      ? `/tournaments/${encodeURIComponent(tournament.slug)}`
      : null;
  const hasBracket = tournament.bracketGenerated;

  return (
    <div className="space-y-8 px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/tournaments" className="hover:underline">
            {ta('backToList')}
          </Link>
        }
        title={tournament.name}
        badges={
          <>
            <TournamentStatusPill status={tournament.status} />
            {tournament.isSample ? <SampleDataBadge /> : null}
          </>
        }
        actions={
          publicHref ? (
            <Link
              href={publicHref}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              {ta('viewPublic')}
            </Link>
          ) : null
        }
      />

      {showDemoBanner ? <DemoModeBanner /> : null}
      {readOnly ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" role="note">
          {ta('sampleReadOnly')}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{ta('lifecycle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted">{ta(`lifecycleHint.${tournament.status}`)}</p>
          <div className="flex flex-wrap gap-2">
            {tournament.status === 'REGISTRATION_CLOSED' &&
            !tournament.bracketGenerated &&
            !readOnly ? (
              <GenerateBracketButton
                tournamentId={tournament.id}
                approvedCount={tournament.approvedTeamCount}
              />
            ) : null}
            {targets.map((to) => (
              <TournamentStatusButton
                key={to}
                tournamentId={tournament.id}
                tournamentName={tournament.name}
                to={to}
              />
            ))}
            {hasBracket ? (
              <Link
                href={`/admin/matches?tournament=${encodeURIComponent(tournament.slug)}`}
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                {ta('manageMatches')}
              </Link>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <DetailSection id="settings" title={ta('settings')}>
        {canEditTournament(tournament.status) && !readOnly ? (
          <div className="max-w-4xl">
            <TournamentForm tournament={tournament} />
          </div>
        ) : (
          <ReadOnlySettings tournament={tournament} />
        )}
      </DetailSection>

      <RegistrationsSection
        tournament={tournament}
        raw={raw}
        readOnly={readOnly}
        demoMode={demoMode}
      />

      {tournament.status === 'REGISTRATION_CLOSED' && !tournament.bracketGenerated && !readOnly ? (
        <SeedingSection tournament={tournament} />
      ) : null}

      {hasBracket ? <BracketSection slug={tournament.slug} /> : null}
    </div>
  );
}

async function ReadOnlySettings({ tournament }: { tournament: AdminTournamentDto }) {
  const [ta, tt] = await Promise.all([
    getTranslations('adminTournaments'),
    getTranslations('tournaments'),
  ]);
  return (
    <Card>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted">{ta('settingsLocked')}</p>
        <Facts
          items={[
            { label: tt('matchFormat'), value: tournament.defaultMatchFormat },
            {
              label: tt('finalFormat'),
              value: tournament.finalMatchFormat ?? tournament.defaultMatchFormat,
            },
            {
              label: tt('teams'),
              value:
                tournament.maxTeams !== null
                  ? tt('teamsOfMax', {
                      count: tournament.approvedTeamCount,
                      max: tournament.maxTeams,
                    })
                  : tournament.approvedTeamCount,
            },
            {
              label: tt('startsAt'),
              value: <FormattedDate value={tournament.startsAt} withTime />,
            },
          ]}
        />
        {tournament.mapPool.length > 0 ? <MapPoolList maps={tournament.mapPool} /> : null}
      </CardContent>
    </Card>
  );
}

async function RegistrationsSection({
  tournament,
  raw,
  readOnly,
  demoMode,
}: {
  tournament: AdminTournamentDto;
  raw: RawSearchParams;
  readOnly: boolean;
  demoMode: boolean;
}) {
  const [ta, ts] = await Promise.all([
    getTranslations('adminTournaments'),
    getTranslations('registrationStatus'),
  ]);
  const { page, pageSize } = parseListParams(raw);
  const status: RegistrationStatus = pickParam(raw, 'reg', REGISTRATION_STATUSES) ?? 'PENDING';
  const result = await getAdminRegistrations(tournament.id, { status, page, pageSize });
  const path = `/admin/tournaments/${encodeURIComponent(tournament.id)}`;
  const canReview = !readOnly && status === 'PENDING';
  const canSubstitute =
    !readOnly &&
    status === 'APPROVED' &&
    tournament.status !== 'COMPLETED' &&
    tournament.status !== 'CANCELLED';

  // Substitution candidates: current team members not on the locked roster (public team reads).
  const candidatesByReg = new Map<string, SubstitutePlayer[]>();
  if (canSubstitute && result.ok) {
    const teams = await Promise.all(
      result.data.items.map((r) => (SLUG_PATTERN.test(r.team.slug) ? getTeam(r.team.slug) : null)),
    );
    result.data.items.forEach((registration, index) => {
      const team = teams[index];
      if (!team || !team.ok) return;
      const onRoster = new Set(registration.roster.entries.map((e) => e.userId));
      candidatesByReg.set(
        registration.id,
        team.data.roster
          .filter((m) => m.userId && !onRoster.has(m.userId))
          .map((m) => ({ userId: m.userId, nickname: m.nickname })),
      );
    });
  }

  return (
    <DetailSection id="registrations" title={ta('registrations')}>
      <nav aria-label={ta('registrationFilter')} className="overflow-x-auto">
        <ul className="inline-flex min-w-full gap-1 border-b border-border">
          {REGISTRATION_STATUSES.map((s) => (
            <li key={s}>
              <Link
                href={`${listHref(path, { reg: s === 'PENDING' ? undefined : s })}#registrations`}
                aria-current={s === status ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
                  s === status
                    ? 'border-accent text-foreground'
                    : 'border-transparent text-muted hover:text-foreground',
                )}
              >
                {ts(s)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {!result.ok ? (
        <ApiErrorState failure={result} headingLevel="h3" />
      ) : result.data.items.length === 0 ? (
        <EmptyState
          compact
          headingLevel="h3"
          icon={ClipboardList}
          title={ta('registrationsEmpty', { status: ts(status) })}
        />
      ) : (
        <div>
          <Table>
            <TableCaption>
              {ta('registrationsCaption', {
                status: ts(status),
                page,
                totalPages: totalPages(result.data.total, result.data.pageSize),
              })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{ta('colTeam')}</TableHead>
                <TableHead>{ta('colRoster')}</TableHead>
                <TableHead className="hidden md:table-cell">{ta('colSubmitted')}</TableHead>
                <TableHead>{ta('colStatus')}</TableHead>
                <TableHead>
                  <span className="sr-only">{ta('colActions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.items.map((registration) => (
                <RegistrationRow
                  key={registration.id}
                  tournamentId={tournament.id}
                  registration={registration}
                  canReview={canReview && sampleActionsAllowed(registration.isSample, demoMode)}
                  allowSample={demoMode}
                  candidates={canSubstitute ? (candidatesByReg.get(registration.id) ?? []) : null}
                />
              ))}
            </TableBody>
          </Table>
          <ListPagination
            pathname={path}
            page={page}
            pageSize={result.data.pageSize}
            total={result.data.total}
            params={{ reg: status === 'PENDING' ? undefined : status }}
          />
        </div>
      )}
    </DetailSection>
  );
}

async function RegistrationRow({
  tournamentId,
  registration,
  canReview,
  candidates,
  allowSample,
}: {
  tournamentId: string;
  registration: AdminRegistrationDto;
  canReview: boolean;
  /** null = substitution not offered. */
  candidates: SubstitutePlayer[] | null;
  /** Demo mode: sample registrations accept admin actions. */
  allowSample: boolean;
}) {
  const ta = await getTranslations('adminTournaments');
  const roster = registration.roster;
  return (
    <TableRow>
      <TableCell className="min-w-36 align-top">
        <div className="flex flex-wrap items-center gap-1.5">
          {SLUG_PATTERN.test(registration.team.slug) ? (
            <Link
              href={`/teams/${encodeURIComponent(registration.team.slug)}`}
              className="font-medium hover:text-accent-text hover:underline"
            >
              {registration.team.name}
            </Link>
          ) : (
            <span className="font-medium">{registration.team.name}</span>
          )}
          <Badge tone="outline" className="font-mono">
            {registration.team.tag}
          </Badge>
          {registration.isSample ? <SampleDataBadge /> : null}
        </div>
        {registration.seed !== null ? (
          <p className="mt-1 text-xs text-muted">{ta('seedValue', { seed: registration.seed })}</p>
        ) : null}
        {registration.reviewReason ? (
          <p className="mt-1 whitespace-pre-line break-words text-xs">
            <span className="font-medium">{ta('reviewReason')}</span> {registration.reviewReason}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="align-top">
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <RosterStatusBadge status={roster.status} />
          {ta('rosterVersion', { version: roster.version })}
        </div>
        <ul className="space-y-0.5 text-xs">
          {roster.entries.map((entry) => (
            <li key={entry.userId} className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{entry.nickname}</span>
              <span className="font-mono text-muted">{entry.steamId64}</span>
              {entry.role === 'SUBSTITUTE' ? <RosterRoleBadge role={entry.role} /> : null}
              {entry.noLongerMember ? (
                <Badge tone="warning" data-testid="no-longer-member">
                  {ta('noLongerMember')}
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      </TableCell>
      <TableCell className="hidden whitespace-nowrap align-top text-xs md:table-cell">
        <FormattedDate value={registration.createdAt} withTime />
      </TableCell>
      <TableCell className="align-top">
        <RegistrationStatusBadge status={registration.status} />
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-wrap justify-end gap-1.5">
          {canReview && registration.status === 'PENDING' ? (
            <>
              <ApproveRegistrationButton
                tournamentId={tournamentId}
                registrationId={registration.id}
                teamName={registration.team.name}
              />
              <RejectRegistrationButton
                tournamentId={tournamentId}
                registrationId={registration.id}
                teamName={registration.team.name}
              />
            </>
          ) : null}
          {candidates !== null &&
          registration.status === 'APPROVED' &&
          sampleActionsAllowed(registration.isSample, allowSample) ? (
            <SubstituteDialog
              tournamentId={tournamentId}
              registrationId={registration.id}
              teamName={registration.team.name}
              roster={roster.entries.map((e) => ({
                userId: e.userId,
                nickname: e.nickname,
                role: e.role,
              }))}
              candidates={candidates}
            />
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

async function SeedingSection({ tournament }: { tournament: AdminTournamentDto }) {
  const ta = await getTranslations('adminTournaments');
  const approved = await getAdminRegistrations(tournament.id, {
    status: 'APPROVED',
    page: 1,
    pageSize: 100,
  });
  return (
    <DetailSection id="seeding" title={ta('seeding')}>
      {!approved.ok ? (
        <ApiErrorState failure={approved} headingLevel="h3" />
      ) : approved.data.items.length === 0 ? (
        <EmptyState compact headingLevel="h3" icon={ClipboardList} title={ta('seedingEmpty')} />
      ) : (
        <div className="max-w-2xl">
          <SeedingEditor
            tournamentId={tournament.id}
            rows={approved.data.items.map((r) => ({
              registrationId: r.id,
              teamName: r.team.name,
              teamTag: r.team.tag,
              seed: r.seed,
            }))}
          />
        </div>
      )}
    </DetailSection>
  );
}

async function BracketSection({ slug }: { slug: string }) {
  const ta = await getTranslations('adminTournaments');
  const bracket = await getTournamentBracket(slug);
  return (
    <DetailSection id="bracket" title={ta('bracket')}>
      {bracket.ok && bracket.data.rounds.length > 0 ? (
        <BracketView bracket={bracket.data} />
      ) : bracket.ok || bracket.kind === 'not_found' ? (
        <EmptyState compact headingLevel="h3" icon={GitBranch} title={ta('bracketMissing')} />
      ) : (
        <ApiErrorState failure={bracket} headingLevel="h3" />
      )}
    </DetailSection>
  );
}

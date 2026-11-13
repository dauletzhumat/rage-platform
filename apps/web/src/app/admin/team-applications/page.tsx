import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { FileCheck2 } from 'lucide-react';
import { Country, FormattedDate } from '@/components/domain/formatting';
import { ListPagination } from '@/components/domain/list-controls';
import { ApiErrorState } from '@/components/states/api-error-state';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { ApproveApplicationButton, RejectApplicationButton } from '@/components/teams/team-actions';
import { ApplicationStatusBadge } from '@/components/teams/status-badges';
import { Badge } from '@/components/ui/badge';
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
import { getAdminTeamApplications, getMe, SLUG_PATTERN } from '@/lib/api/server';
import { TEAM_APPLICATION_STATUSES, type TeamApplicationStatus } from '@/lib/api/types';
import { isSuperAdmin } from '@/lib/auth/roles';
import {
  listHref,
  parseListParams,
  pickParam,
  totalPages,
  type RawSearchParams,
} from '@/lib/list-params';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin');
  return { title: `${t('teamApplications')} · ${t('title')}` };
}

const PATH = '/admin/team-applications';

/** SUPER_ADMIN review queue (TEAMS.md §4.1): filter by status, approve / reject with reason. */
export default async function AdminTeamApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const [me, t, ta, ts] = await Promise.all([
    getMe(),
    getTranslations('admin'),
    getTranslations('adminApplications'),
    getTranslations('applicationStatus'),
  ]);
  if (!me.ok) return null; // the layout already rendered the appropriate state

  if (!isSuperAdmin(me.data.roles)) {
    return (
      <div className="space-y-6 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('teamApplications')}</h1>
        <ForbiddenState title={t('superAdminOnlyTitle')} description={ta('superAdminOnly')} />
      </div>
    );
  }

  const raw = await searchParams;
  const { page, pageSize } = parseListParams(raw);
  const status: TeamApplicationStatus =
    pickParam(raw, 'status', TEAM_APPLICATION_STATUSES) ?? 'PENDING';
  const result = await getAdminTeamApplications({ status, page, pageSize });
  const statusParam = status === 'PENDING' ? undefined : status;

  return (
    <div className="space-y-6 px-4 py-8 sm:px-6">
      <PageHeader title={t('teamApplications')} description={ta('description')} />

      <nav aria-label={ta('filterLabel')} className="overflow-x-auto">
        <ul className="inline-flex min-w-full gap-1 border-b border-border">
          {TEAM_APPLICATION_STATUSES.map((s) => {
            const active = s === status;
            return (
              <li key={s}>
                <Link
                  href={listHref(PATH, { status: s === 'PENDING' ? undefined : s })}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    '-mb-px inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
                    active
                      ? 'border-accent text-foreground'
                      : 'border-transparent text-muted hover:text-foreground',
                  )}
                >
                  {ts(s)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {!result.ok ? (
        <ApiErrorState failure={result} />
      ) : result.data.items.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title={ta('empty', { status: ts(status) })}
          description={status === 'PENDING' ? ta('emptyPendingDescription') : undefined}
        />
      ) : (
        <div>
          <Table>
            <TableCaption>
              {ta('caption', {
                status: ts(status),
                page,
                totalPages: totalPages(result.data.total, result.data.pageSize),
              })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{ta('colTeam')}</TableHead>
                <TableHead>{ta('colApplicant')}</TableHead>
                <TableHead className="hidden md:table-cell">{ta('colDescription')}</TableHead>
                <TableHead>{ta('colSubmitted')}</TableHead>
                <TableHead>{ta('colStatus')}</TableHead>
                <TableHead>
                  <span className="sr-only">{ta('colActions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.items.map((application) => {
                const applicantHref = SLUG_PATTERN.test(application.applicant.playerSlug)
                  ? `/players/${encodeURIComponent(application.applicant.playerSlug)}`
                  : null;
                const teamHref =
                  application.createdTeam && SLUG_PATTERN.test(application.createdTeam.slug)
                    ? `/teams/${encodeURIComponent(application.createdTeam.slug)}`
                    : null;
                return (
                  <TableRow key={application.id}>
                    <TableCell className="min-w-40 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {teamHref ? (
                          <Link href={teamHref} className="font-medium hover:text-accent-text">
                            {application.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{application.name}</span>
                        )}
                        <Badge tone="outline" className="font-mono">
                          {application.tag}
                        </Badge>
                        {application.isSample ? <SampleDataBadge /> : null}
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        <Country code={application.countryCode} />
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      {applicantHref ? (
                        <Link href={applicantHref} className="hover:text-accent-text">
                          {application.applicant.nickname}
                        </Link>
                      ) : (
                        application.applicant.nickname
                      )}
                      <div className="font-mono text-xs text-muted">
                        {application.applicant.steamId64}
                      </div>
                    </TableCell>
                    <TableCell className="hidden max-w-sm align-top md:table-cell">
                      {application.description ? (
                        <p className="line-clamp-4 whitespace-pre-line break-words text-xs text-muted">
                          {application.description}
                        </p>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                      {application.reviewReason ? (
                        <p className="mt-1 whitespace-pre-line break-words text-xs">
                          <span className="font-medium">{ta('reviewNote')}</span>{' '}
                          {application.reviewReason}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap align-top text-xs">
                      <FormattedDate value={application.createdAt} withTime />
                    </TableCell>
                    <TableCell className="align-top">
                      <ApplicationStatusBadge status={application.status} />
                    </TableCell>
                    <TableCell className="align-top">
                      {application.status === 'PENDING' && !application.isSample ? (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <ApproveApplicationButton
                            applicationId={application.id}
                            teamName={application.name}
                            teamTag={application.tag}
                            summary={application.description}
                          />
                          <RejectApplicationButton
                            applicationId={application.id}
                            teamName={application.name}
                            summary={application.description}
                          />
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <ListPagination
            pathname={PATH}
            page={page}
            pageSize={result.data.pageSize}
            total={result.data.total}
            params={{ status: statusParam }}
          />
        </div>
      )}
    </div>
  );
}

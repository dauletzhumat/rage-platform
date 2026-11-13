import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { FileText, Hourglass, Users } from 'lucide-react';
import { Country, FormattedDate } from '@/components/domain/formatting';
import { ApiErrorState } from '@/components/states/api-error-state';
import { AuthRequired } from '@/components/states/auth-required';
import { WithdrawApplicationButton } from '@/components/teams/team-actions';
import { ApplicationStatusBadge } from '@/components/teams/status-badges';
import { TeamApplicationForm } from '@/components/teams/team-application-form';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getMe, getMyTeamApplications, SLUG_PATTERN } from '@/lib/api/server';
import type { TeamApplicationDto } from '@/lib/api/types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('protected');
  return { title: t('applyTitle'), robots: { index: false, follow: false } };
}

function teamHref(slug: string): string | null {
  return SLUG_PATTERN.test(slug) ? `/teams/${encodeURIComponent(slug)}` : null;
}

/**
 * Team creation application (TEAMS.md §10). Anonymous → sign-in required (no form).
 * Signed in → own applications + the form, hidden while the user is in a team or has a
 * PENDING application. A team exists only after an administrator approves.
 */
export default async function TeamApplyPage() {
  const [me, tp, t] = await Promise.all([
    getMe(),
    getTranslations('protected'),
    getTranslations('teamApply'),
  ]);

  if (!me.ok) {
    if (me.kind === 'unauthenticated') {
      return <AuthRequired pageTitle={tp('applyTitle')} returnTo="/teams/apply" />;
    }
    return (
      <Container className="space-y-6 py-8">
        <PageHeader title={tp('applyTitle')} />
        <ApiErrorState failure={me} />
      </Container>
    );
  }

  const applications = await getMyTeamApplications();
  const membership = me.data.membership ?? null;
  const pendingApplication = applications.ok
    ? (applications.data.find((a) => a.status === 'PENDING') ?? null)
    : null;
  const membershipHref = membership ? teamHref(membership.teamSlug) : null;

  return (
    <Container className="space-y-8 py-8">
      <PageHeader title={tp('applyTitle')} description={t('description')} />

      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('formTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {membership ? (
              <EmptyState
                compact
                icon={Users}
                headingLevel="h3"
                title={t('inTeamTitle')}
                description={t('inTeamDescription', { team: membership.teamName })}
                action={
                  membershipHref ? (
                    <Link
                      href={membershipHref}
                      className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                    >
                      {t('viewMyTeam')}
                    </Link>
                  ) : null
                }
              />
            ) : !applications.ok ? (
              <p className="text-sm text-muted">{t('formUnavailable')}</p>
            ) : pendingApplication ? (
              <EmptyState
                compact
                icon={Hourglass}
                headingLevel="h3"
                title={t('pendingTitle')}
                description={t('pendingDescription', { name: pendingApplication.name })}
              />
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted">{t('formIntro')}</p>
                <TeamApplicationForm />
              </div>
            )}
          </CardContent>
        </Card>

        <section aria-labelledby="my-applications" className="space-y-3">
          <h2
            id="my-applications"
            className="text-sm font-semibold uppercase tracking-wider text-muted"
          >
            {t('myApplications')}
          </h2>
          {!applications.ok ? (
            <ApiErrorState failure={applications} headingLevel="h3" />
          ) : applications.data.length === 0 ? (
            <EmptyState
              compact
              icon={FileText}
              headingLevel="h3"
              title={t('noApplications')}
              description={t('noApplicationsDescription')}
            />
          ) : (
            <ul className="space-y-3" data-testid="my-applications">
              {applications.data.map((application) => (
                <ApplicationItem key={application.id} application={application} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Container>
  );
}

async function ApplicationItem({ application }: { application: TeamApplicationDto }) {
  const t = await getTranslations('teamApply');
  const createdHref = application.createdTeam ? teamHref(application.createdTeam.slug) : null;
  return (
    <li className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 truncate font-semibold">{application.name}</h3>
        <Badge tone="outline" className="font-mono">
          {application.tag}
        </Badge>
        <ApplicationStatusBadge status={application.status} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">{t('submittedAt')}</dt>
        <dd>
          <FormattedDate value={application.createdAt} withTime />
        </dd>
        <dt className="text-muted">{t('country')}</dt>
        <dd>
          <Country code={application.countryCode} />
        </dd>
        {application.reviewedAt ? (
          <>
            <dt className="text-muted">{t('reviewedAt')}</dt>
            <dd>
              <FormattedDate value={application.reviewedAt} withTime />
            </dd>
          </>
        ) : null}
      </dl>
      {application.status === 'REJECTED' && application.reviewReason ? (
        <p className="whitespace-pre-line break-words rounded-md border border-danger/30 bg-danger/5 p-2 text-sm">
          <span className="font-medium">{t('rejectReason')}</span> {application.reviewReason}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {application.status === 'PENDING' ? (
          <WithdrawApplicationButton applicationId={application.id} teamName={application.name} />
        ) : null}
        {application.status === 'APPROVED' && application.createdTeam && createdHref ? (
          <Link href={createdHref} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            {t('openTeam', { name: application.createdTeam.name })}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

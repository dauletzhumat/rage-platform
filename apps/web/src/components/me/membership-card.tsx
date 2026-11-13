import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FormattedDate } from '@/components/domain/formatting';
import { LeaveTeamButton } from '@/components/teams/team-actions';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { MeMembershipDto } from '@/lib/api/types';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * Current team membership on /me (TEAMS.md §4.4, §10). Leave is offered to non-captains; the
 * captain is told to transfer captaincy first (the API enforces CAPTAIN_MUST_TRANSFER).
 * `membership === undefined` means the API does not report memberships yet → nothing claimed.
 */
export function MembershipCard({ membership }: { membership: MeMembershipDto | null | undefined }) {
  const t = useTranslations('me');
  const tr = useTranslations('roles');

  if (membership === undefined) return null;

  const teamHref =
    membership && SLUG.test(membership.teamSlug)
      ? `/teams/${encodeURIComponent(membership.teamSlug)}`
      : null;

  return (
    <Card data-testid="membership-card">
      <CardHeader>
        <CardTitle>{t('teamTitle')}</CardTitle>
        <Link href="/me/invitations" className="text-xs text-accent-text hover:underline">
          {t('invitationsLink')}
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        {membership ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">{t('team')}</dt>
              <dd className="min-w-0 truncate font-medium">
                {teamHref ? (
                  <Link href={teamHref} className="hover:text-accent-text hover:underline">
                    {membership.teamName}
                  </Link>
                ) : (
                  membership.teamName
                )}
              </dd>
              <dt className="text-muted">{t('teamRole')}</dt>
              <dd>
                <Badge tone={membership.role === 'CAPTAIN' ? 'accent' : 'neutral'}>
                  {tr(membership.role)}
                </Badge>
              </dd>
              <dt className="text-muted">{t('joinedAt')}</dt>
              <dd>
                <FormattedDate value={membership.joinedAt} />
              </dd>
            </dl>
            {membership.role === 'CAPTAIN' ? (
              <div className="space-y-2">
                <p className="text-xs text-muted">{t('captainMustTransfer')}</p>
                {teamHref ? (
                  <Link
                    href={`${teamHref}/manage`}
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  >
                    {t('manageTeam')}
                  </Link>
                ) : null}
              </div>
            ) : (
              <LeaveTeamButton teamId={membership.teamId} teamName={membership.teamName} />
            )}
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t('noTeam')}</p>
            <Link
              href="/teams/apply"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              {t('applyForTeam')}
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

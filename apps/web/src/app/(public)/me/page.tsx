import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { UserAvatar } from '@/components/layout/user-avatar';
import { FormattedDate } from '@/components/domain/formatting';
import { RoleChip } from '@/components/domain/role-chip';
import { ProfileForm } from '@/components/me/profile-form';
import { ApiErrorState } from '@/components/states/api-error-state';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { PageHeader } from '@/components/ui/page-header';
import { getMe } from '@/lib/api/server';
import { loginHref } from '@/lib/auth/return-to';
import { safeSteamProfileUrl } from '@/lib/steam-hosts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('protected');
  return { title: t('meTitle'), robots: { index: false, follow: false } };
}

/** The signed-in user's account: verified Steam binding, editable RAGE profile, roles. */
export default async function MePage() {
  const [me, tp, t, tStatus] = await Promise.all([
    getMe(),
    getTranslations('protected'),
    getTranslations('me'),
    getTranslations('userStatus'),
  ]);

  if (!me.ok && me.kind === 'unauthenticated') redirect(loginHref('/me'));
  if (!me.ok) {
    return (
      <Container className="space-y-6 py-8">
        <PageHeader title={tp('meTitle')} />
        <ApiErrorState failure={me} />
      </Container>
    );
  }

  const { user, profile, steamProfile, roles } = me.data;
  const steamUrl = safeSteamProfileUrl(steamProfile?.profileUrl);
  const steamName = steamProfile?.displayName ?? null;

  return (
    <Container className="space-y-6 py-8">
      <PageHeader
        title={tp('meTitle')}
        description={t('description')}
        actions={
          <Link
            href={`/players/${profile.slug}`}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            {t('publicProfile')}
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('identityTitle')}</CardTitle>
              <Badge tone="success">
                <ShieldCheck aria-hidden="true" />
                {t('verifiedBadge')}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <UserAvatar
                  name={steamName ?? profile.nickname}
                  avatarUrl={steamProfile?.avatarUrl}
                  size="lg"
                />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{steamName ?? profile.nickname}</p>
                  {steamUrl ? (
                    <a
                      href={steamUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline"
                    >
                      {t('viewSteamProfile')}
                      <ExternalLink aria-hidden="true" className="size-3" />
                    </a>
                  ) : null}
                </div>
              </div>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wider text-muted">{t('steamId')}</dt>
                  <dd className="font-mono" data-testid="me-steam-id">
                    {user.steamId64}
                  </dd>
                  <dd className="mt-1 text-xs text-muted">{t('steamIdHint')}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-muted">{t('steamName')}</dt>
                  <dd>{steamName ?? <span className="text-muted">{t('steamNotSynced')}</span>}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('rolesTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {roles.length === 0 ? (
                <p className="text-sm text-muted">{t('rolesEmpty')}</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {roles.map((role) => (
                    <li key={role.id}>
                      <RoleChip role={role.role} scopeType={role.scopeType} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('accountTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">{t('status')}</dt>
                <dd>{tStatus(user.status)}</dd>
                <dt className="text-muted">{t('memberSince')}</dt>
                <dd>
                  <FormattedDate value={user.createdAt} />
                </dd>
                <dt className="text-muted">{t('lastLogin')}</dt>
                <dd>
                  <FormattedDate value={user.lastLoginAt} withTime />
                </dd>
              </dl>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('profileTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm
              initial={{
                nickname: profile.nickname,
                countryCode: profile.countryCode ?? '',
                biography: profile.biography ?? '',
              }}
            />
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}

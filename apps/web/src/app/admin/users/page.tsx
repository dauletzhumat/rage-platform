import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { SearchX, Users } from 'lucide-react';
import { UserRolesEditor } from '@/components/admin/user-roles-editor';
import { FormattedDate } from '@/components/domain/formatting';
import { ListPagination, SearchForm } from '@/components/domain/list-controls';
import { ApiErrorState } from '@/components/states/api-error-state';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getAdminUsers, getMe } from '@/lib/api/server';
import type { UserStatus } from '@/lib/api/types';
import { isSuperAdmin } from '@/lib/auth/roles';
import { parseListParams, totalPages, type RawSearchParams } from '@/lib/list-params';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin');
  return { title: `${t('users')} · ${t('title')}` };
}

const statusTone: Record<UserStatus, BadgeTone> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  BANNED: 'danger',
};

/** SUPER_ADMIN: searchable, paginated users with role grant/revoke (GET /admin/users). */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const [me, t, tc, tStatus] = await Promise.all([
    getMe(),
    getTranslations('admin'),
    getTranslations('common'),
    getTranslations('userStatus'),
  ]);
  if (!me.ok) return null; // the layout already rendered the appropriate state

  if (!isSuperAdmin(me.data.roles)) {
    return (
      <div className="space-y-6 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('users')}</h1>
        <ForbiddenState
          title={t('superAdminOnlyTitle')}
          description={t('superAdminOnlyDescription')}
        />
      </div>
    );
  }

  const { page, pageSize, q } = parseListParams(await searchParams);
  const result = await getAdminUsers({ page, pageSize, q });

  return (
    <div className="space-y-6 px-4 py-8 sm:px-6">
      <PageHeader title={t('users')} description={t('usersDescription')} />
      <SearchForm action="/admin/users" label={t('usersSearchLabel')} q={q} />
      {!result.ok ? (
        <ApiErrorState failure={result} />
      ) : result.data.items.length === 0 ? (
        q ? (
          <EmptyState
            icon={SearchX}
            title={tc('noSearchResults', { q })}
            description={tc('noSearchResultsDescription')}
          />
        ) : (
          <EmptyState
            icon={Users}
            title={t('usersEmpty')}
            description={t('usersEmptyDescription')}
          />
        )
      ) : (
        <div>
          <Table>
            <TableCaption>
              {t('usersCaption', {
                page,
                totalPages: totalPages(result.data.total, result.data.pageSize),
              })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colUser')}</TableHead>
                <TableHead>{t('colSteamId')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead>{t('colRoles')}</TableHead>
                <TableHead>{t('colLastLogin')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.items.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    <Link href={`/players/${user.slug}`} className="hover:text-accent-text">
                      {user.nickname ?? '—'}
                    </Link>
                    {user.id === me.data.user.id ? (
                      <Badge tone="info" className="ml-2">
                        {t('you')}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted">{user.steamId64}</TableCell>
                  <TableCell>
                    <Badge tone={statusTone[user.status] ?? 'neutral'}>
                      {tStatus(user.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="min-w-64">
                    <UserRolesEditor
                      user={{ id: user.id, nickname: user.nickname ?? user.steamId64 }}
                      grants={user.roles}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    <FormattedDate value={user.lastLoginAt} withTime />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ListPagination
            pathname="/admin/users"
            page={page}
            pageSize={result.data.pageSize}
            total={result.data.total}
            params={{ q }}
          />
        </div>
      )}
    </div>
  );
}

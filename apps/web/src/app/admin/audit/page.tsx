import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ScrollText } from 'lucide-react';
import { FormattedDate } from '@/components/domain/formatting';
import { ListPagination } from '@/components/domain/list-controls';
import { ApiErrorState } from '@/components/states/api-error-state';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { NativeSelect } from '@/components/ui/input';
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
import { getAuditLogs, getMe } from '@/lib/api/server';
import { isSuperAdmin } from '@/lib/auth/roles';
import { parseListParams, pickParam, totalPages, type RawSearchParams } from '@/lib/list-params';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin');
  return { title: `${t('auditLog')} · ${t('title')}` };
}

/** M1 audit actions (docs/AUTH.md §10). The filter only offers known values. */
const AUDIT_ACTIONS = [
  'auth.login',
  'auth.logout',
  'auth.login_rejected',
  'profile.update',
  'role_grant.create',
  'role_grant.revoke',
  'role_grant.bootstrap',
] as const;

function shortId(id: string | null): string | null {
  return id ? id.slice(0, 8) : null;
}

/** SUPER_ADMIN: paginated audit log, newest first (GET /admin/audit). */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const [me, t] = await Promise.all([getMe(), getTranslations('admin')]);
  if (!me.ok) return null; // the layout already rendered the appropriate state

  if (!isSuperAdmin(me.data.roles)) {
    return (
      <div className="space-y-6 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('auditLog')}</h1>
        <ForbiddenState
          title={t('superAdminOnlyTitle')}
          description={t('superAdminOnlyDescription')}
        />
      </div>
    );
  }

  const raw = await searchParams;
  const { page, pageSize } = parseListParams(raw);
  const action = pickParam(raw, 'action', AUDIT_ACTIONS);
  const result = await getAuditLogs({ page, pageSize, ...(action ? { action } : {}) });

  return (
    <div className="space-y-6 px-4 py-8 sm:px-6">
      <PageHeader title={t('auditLog')} description={t('auditDescription')} />
      <form action="/admin/audit" method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('auditFilterLabel')}
          <NativeSelect name="action" defaultValue={action ?? ''} className="w-64">
            <option value="">{t('auditAllActions')}</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" variant="secondary">
          {t('auditApply')}
        </Button>
      </form>
      {!result.ok ? (
        <ApiErrorState failure={result} />
      ) : result.data.items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={t('auditEmpty')}
          description={t('auditEmptyDescription')}
        />
      ) : (
        <div>
          <Table>
            <TableCaption>
              {t('auditCaption', {
                page,
                totalPages: totalPages(result.data.total, result.data.pageSize),
              })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colTime')}</TableHead>
                <TableHead>{t('colAction')}</TableHead>
                <TableHead>{t('colResource')}</TableHead>
                <TableHead>{t('colActor')}</TableHead>
                <TableHead>{t('colRequest')}</TableHead>
                <TableHead>{t('colDetail')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.items.map((entry) => (
                <TableRow key={entry.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-xs">
                    <FormattedDate value={entry.createdAt} withTime />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                  <TableCell className="text-xs">
                    <span>{entry.resourceType}</span>
                    {entry.resourceId ? (
                      <span className="ml-1 font-mono text-muted" title={entry.resourceId}>
                        {shortId(entry.resourceId)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted">
                    {entry.actorUserId ? (
                      <span title={entry.actorUserId}>{shortId(entry.actorUserId)}</span>
                    ) : (
                      t('system')
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted">
                    {entry.requestId ?? '—'}
                  </TableCell>
                  <TableCell className="max-w-md text-xs">
                    <details>
                      <summary className="cursor-pointer text-muted hover:text-foreground">
                        {t('showDetail')}
                      </summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-raised p-2 font-mono text-[11px]">
                        {JSON.stringify(entry.detail, null, 2)}
                      </pre>
                    </details>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ListPagination
            pathname="/admin/audit"
            page={page}
            pageSize={result.data.pageSize}
            total={result.data.total}
            params={{ action }}
          />
        </div>
      )}
    </div>
  );
}

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ShieldBan } from 'lucide-react';
import { FormattedDate } from '@/components/domain/formatting';
import { ListPagination } from '@/components/domain/list-controls';
import { DetailSection } from '@/components/domain/section';
import { ApiErrorState } from '@/components/states/api-error-state';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { BanForm } from '@/components/tournaments/ban-form';
import { LiftBanButton } from '@/components/tournaments/tournament-actions';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { getBannedSteamIds, getMe } from '@/lib/api/server';
import { isSuperAdmin } from '@/lib/auth/roles';
import { parseListParams, totalPages, type RawSearchParams } from '@/lib/list-params';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin');
  return { title: `${t('bans')} · ${t('title')}` };
}

const PATH = '/admin/bans';

/** SUPER_ADMIN SteamID64 ban list (docs/TOURNAMENTS.md §5). */
export default async function AdminBansPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const [me, t, tb] = await Promise.all([
    getMe(),
    getTranslations('admin'),
    getTranslations('adminBans'),
  ]);
  if (!me.ok) return null;

  if (!isSuperAdmin(me.data.roles)) {
    return (
      <div className="space-y-6 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('bans')}</h1>
        <ForbiddenState title={t('superAdminOnlyTitle')} description={tb('superAdminOnly')} />
      </div>
    );
  }

  const { page, pageSize } = parseListParams(await searchParams);
  const result = await getBannedSteamIds({ page, pageSize });

  return (
    <div className="space-y-8 px-4 py-8 sm:px-6">
      <PageHeader title={t('bans')} description={tb('description')} />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{tb('newBan')}</CardTitle>
        </CardHeader>
        <CardContent>
          <BanForm />
        </CardContent>
      </Card>

      <DetailSection id="ban-list" title={tb('listTitle')}>
        {!result.ok ? (
          <ApiErrorState failure={result} headingLevel="h3" />
        ) : result.data.items.length === 0 ? (
          <EmptyState compact headingLevel="h3" icon={ShieldBan} title={tb('empty')} />
        ) : (
          <div>
            <Table>
              <TableCaption>
                {tb('caption', {
                  page,
                  totalPages: totalPages(result.data.total, result.data.pageSize),
                })}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{tb('colSteamId')}</TableHead>
                  <TableHead>{tb('colReason')}</TableHead>
                  <TableHead className="hidden md:table-cell">{tb('colCreated')}</TableHead>
                  <TableHead>{tb('colStatus')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{tb('colActions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.items.map((ban) => {
                  const active = ban.active;
                  return (
                    <TableRow key={ban.id}>
                      <TableCell className="align-top font-mono text-xs">{ban.steamId64}</TableCell>
                      <TableCell className="max-w-sm align-top">
                        <p className="whitespace-pre-line break-words text-xs">{ban.reason}</p>
                        {ban.liftReason ? (
                          <p className="mt-1 whitespace-pre-line break-words text-xs text-muted">
                            <span className="font-medium">{tb('liftReason')}</span> {ban.liftReason}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden align-top text-xs md:table-cell">
                        <FormattedDate value={ban.createdAt} withTime />
                        {ban.createdBy ? (
                          <div className="text-muted">
                            {tb('by', { name: ban.createdBy.nickname })}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">
                        {active ? (
                          <Badge tone="danger">{tb('active')}</Badge>
                        ) : (
                          <div className="space-y-0.5 text-xs">
                            <Badge tone="neutral">{tb('lifted')}</Badge>
                            <div>
                              <FormattedDate value={ban.liftedAt} withTime />
                            </div>
                            {ban.liftedBy ? (
                              <div className="text-muted">
                                {tb('by', { name: ban.liftedBy.nickname })}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {active ? <LiftBanButton banId={ban.id} steamId64={ban.steamId64} /> : null}
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
              params={{}}
            />
          </div>
        )}
      </DetailSection>
    </div>
  );
}

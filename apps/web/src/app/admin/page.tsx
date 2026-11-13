import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RoleChip } from '@/components/domain/role-chip';
import { getMe } from '@/lib/api/server';
import { isSuperAdmin } from '@/lib/auth/roles';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin');
  return { title: `${t('dashboard')} · ${t('title')}` };
}

/** Admin landing page (guarded by the layout). Shows only the viewer's own roles — no fabricated metrics. */
export default async function AdminDashboardPage() {
  const [me, t] = await Promise.all([getMe(), getTranslations('admin')]);
  if (!me.ok) return null; // the layout already rendered the appropriate state
  const superAdmin = isSuperAdmin(me.data.roles);

  const sections: Array<{ href: string; label: string; note: string }> = [
    ...(superAdmin
      ? [
          {
            href: '/admin/team-applications',
            label: t('teamApplications'),
            note: t('teamApplicationsDescription'),
          },
          { href: '/admin/users', label: t('users'), note: t('usersDescription') },
          { href: '/admin/audit', label: t('auditLog'), note: t('auditDescription') },
        ]
      : []),
    { href: '/admin/tournaments', label: t('tournaments'), note: t('tournamentsComing') },
    { href: '/admin/matches', label: t('matches'), note: t('matchesComing') },
    { href: '/admin/servers', label: t('servers'), note: t('serversComing') },
  ];

  return (
    <div className="space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{t('dashboard')}</h1>
        <p className="text-sm text-muted">
          {t('dashboardDescription', { name: me.data.profile.nickname })}
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>{t('dashboardRoles')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-wrap gap-2" aria-label={t('dashboardRoles')}>
            {me.data.roles.map((role) => (
              <li key={role.id}>
                <RoleChip role={role.role} scopeType={role.scopeType} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <ul className="grid gap-3 sm:grid-cols-2">
        {sections.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="group flex h-full flex-col gap-1 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span className="flex items-center justify-between text-sm font-semibold">
                {section.label}
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 text-muted transition-transform group-hover:translate-x-0.5"
                />
              </span>
              <span className="text-xs text-muted">{section.note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

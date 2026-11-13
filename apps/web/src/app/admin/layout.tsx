import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AdminShell } from '@/components/layout/admin-shell';
import { ApiErrorState } from '@/components/states/api-error-state';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { getMe } from '@/lib/api/server';
import { PATH_HEADER } from '@/lib/auth/paths';
import { loginHref } from '@/lib/auth/return-to';
import { resolveAdminAccess } from '@/lib/auth/roles';
import { toViewer } from '@/lib/auth/viewer';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Admin guard (UX only — every admin API call is authorised by the API):
 * no session → /login?returnTo=…; signed in without an admin role → 403 state, no data;
 * API trouble → error state; otherwise the admin shell with navigation.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = resolveAdminAccess(await getMe());

  if (access.kind === 'redirect_login') {
    const path = (await headers()).get(PATH_HEADER) ?? '/admin';
    redirect(loginHref(path.startsWith('/admin') ? path : '/admin'));
  }

  if (access.kind === 'allowed') {
    return (
      <AdminShell viewer={toViewer(access.me)} showNav>
        {children}
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="px-4 py-8 sm:px-6">
        {access.kind === 'forbidden' ? (
          <>
            <h1 className="mb-6 text-2xl font-bold tracking-tight">
              {(await getTranslations('admin'))('title')}
            </h1>
            <ForbiddenState />
          </>
        ) : (
          <ApiErrorState failure={access.result} headingLevel="h1" />
        )}
      </div>
    </AdminShell>
  );
}

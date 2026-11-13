import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Inbox } from 'lucide-react';
import { ApiErrorState } from '@/components/states/api-error-state';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getMe } from '@/lib/api/server';
import { loginHref } from '@/lib/auth/return-to';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('protected');
  return { title: t('invitationsTitle'), robots: { index: false, follow: false } };
}

/** Authenticated invitation inbox. Invitations do not exist until M2 — honest empty state. */
export default async function InvitationsPage() {
  const [me, t] = await Promise.all([getMe(), getTranslations('protected')]);
  if (!me.ok && me.kind === 'unauthenticated') redirect(loginHref('/me/invitations'));

  return (
    <Container className="space-y-6 py-8">
      <PageHeader title={t('invitationsTitle')} />
      {!me.ok ? (
        <ApiErrorState failure={me} />
      ) : (
        <EmptyState
          icon={Inbox}
          title={t('invitationsEmpty')}
          description={t('invitationsComing')}
        />
      )}
    </Container>
  );
}

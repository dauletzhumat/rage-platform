import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthRequired } from '@/components/states/auth-required';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('protected');
  return { title: t('invitationsTitle'), robots: { index: false, follow: false } };
}

/** Protected route. M0: no session exists yet, so render the honest sign-in-required state (no data, no forms). */
export default async function InvitationsPage() {
  const t = await getTranslations('protected');
  return <AuthRequired pageTitle={t('invitationsTitle')} />;
}

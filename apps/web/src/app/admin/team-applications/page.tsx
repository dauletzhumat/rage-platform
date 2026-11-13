import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ComingSoon } from '@/components/states/coming-soon';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin');
  return { title: `${t('teamApplications')} · ${t('title')}` };
}

/** Behind the admin guard (layout). Honest placeholder until the module ships — no data, no fake controls. */
export default async function AdminTeamApplicationsPage() {
  const t = await getTranslations('admin');
  return (
    <ComingSoon
      bare
      pageTitle={t('teamApplications')}
      title={t('comingTitle')}
      description={t('teamApplicationsComing')}
    />
  );
}

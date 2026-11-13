import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProtectedPlaceholder } from '@/components/states/protected-placeholder';
import { UUID_PATTERN } from '@/lib/api/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('protected');
  return { title: t('matchroomTitle'), robots: { index: false, follow: false } };
}

/** Matchroom (M3–M5). Signed in → honest "coming" state (no fake live data); signed out → sign-in required. */
export default async function MatchroomPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, t] = await Promise.all([params, getTranslations('protected')]);
  return (
    <ProtectedPlaceholder
      pageTitle={t('matchroomTitle')}
      returnTo={UUID_PATTERN.test(id) ? `/matchroom/${id}` : '/matches'}
      description={t('matchroomComing')}
    />
  );
}

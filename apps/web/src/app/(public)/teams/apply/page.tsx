import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProtectedPlaceholder } from '@/components/states/protected-placeholder';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('protected');
  return { title: t('applyTitle'), robots: { index: false, follow: false } };
}

/** Team creation application (M2). Signed in → honest "coming in M2"; signed out → sign-in required. */
export default async function TeamApplyPage() {
  const t = await getTranslations('protected');
  return (
    <ProtectedPlaceholder
      pageTitle={t('applyTitle')}
      returnTo="/teams/apply"
      description={t('applyComing')}
    />
  );
}

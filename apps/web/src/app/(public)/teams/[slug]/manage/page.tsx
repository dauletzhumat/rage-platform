import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProtectedPlaceholder } from '@/components/states/protected-placeholder';
import { SLUG_PATTERN } from '@/lib/api/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('protected');
  return { title: t('manageTitle'), robots: { index: false, follow: false } };
}

/** Roster management (M2). Signed in → honest "coming in M2"; signed out → sign-in required. */
export default async function TeamManagePage({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, t] = await Promise.all([params, getTranslations('protected')]);
  return (
    <ProtectedPlaceholder
      pageTitle={t('manageTitle')}
      returnTo={SLUG_PATTERN.test(slug) ? `/teams/${slug}/manage` : '/teams'}
      description={t('manageComing')}
    />
  );
}

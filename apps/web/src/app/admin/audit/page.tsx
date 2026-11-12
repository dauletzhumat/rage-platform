import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthRequired } from '@/components/states/auth-required';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin');
  return { title: `${t('auditLog')} · ${t('title')}` };
}

/** Admin route. M0: no administrator session exists yet — no admin data is fetched or shown. */
export default async function AdminAuditPage() {
  const t = await getTranslations('admin');
  return <AuthRequired variant="admin" pageTitle={t('auditLog')} />;
}

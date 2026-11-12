import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Medal } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('leaderboards');
  return { title: t('title'), description: t('description') };
}

/** M0: no rankings exist; no API call is made and nothing is fabricated. */
export default async function LeaderboardsPage() {
  const t = await getTranslations('leaderboards');
  const empty = (
    <EmptyState icon={Medal} title={t('emptyTitle')} description={t('emptyDescription')} />
  );
  return (
    <Container className="space-y-6 py-8">
      <PageHeader title={t('title')} description={t('description')} />
      <Tabs defaultValue="players">
        <TabsList>
          <TabsTrigger value="players">{t('players')}</TabsTrigger>
          <TabsTrigger value="teams">{t('teams')}</TabsTrigger>
        </TabsList>
        <TabsContent value="players">{empty}</TabsContent>
        <TabsContent value="teams">{empty}</TabsContent>
      </Tabs>
    </Container>
  );
}

import { useTranslations } from 'next-intl';
import { Container } from '@/components/ui/container';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminLoading() {
  const t = useTranslations('common');
  return (
    <Container className="space-y-4 py-10" aria-busy="true">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-48 w-full" />
    </Container>
  );
}

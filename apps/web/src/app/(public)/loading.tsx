import { useTranslations } from 'next-intl';
import { Container } from '@/components/ui/container';
import { Skeleton, TableSkeleton } from '@/components/ui/skeleton';

export default function PublicLoading() {
  const t = useTranslations('common');
  return (
    <Container className="py-8" aria-busy="true">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <div className="space-y-2 border-b border-border pb-5">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="mt-6 h-9 w-full max-w-md" />
      <div className="mt-4">
        <TableSkeleton />
      </div>
    </Container>
  );
}

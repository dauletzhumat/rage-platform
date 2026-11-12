'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Container } from '@/components/ui/container';
import { ErrorState } from '@/components/ui/error-state';
import { RetryButton } from '@/components/states/retry-button';

export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('states');
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Container className="py-12">
      <ErrorState
        headingLevel="h1"
        title={t('errorTitle')}
        description={t('errorDescription')}
        action={<RetryButton onRetry={retry} />}
      />
    </Container>
  );
}

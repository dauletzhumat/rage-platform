'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Container } from '@/components/ui/container';
import { ErrorState } from '@/components/ui/error-state';
import { RetryButton } from '@/components/states/retry-button';

export default function PublicError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('states');
  const tc = useTranslations('common');
  const digest = error instanceof Error && 'digest' in error ? String(error.digest) : undefined;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Container className="py-12">
      <ErrorState
        headingLevel="h1"
        title={t('errorTitle')}
        description={t('errorDescription')}
        meta={digest ? tc('requestId', { id: digest }) : undefined}
        action={<RetryButton onRetry={retry} />}
      />
    </Container>
  );
}

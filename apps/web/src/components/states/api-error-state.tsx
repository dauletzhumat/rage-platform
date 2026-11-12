import { useTranslations } from 'next-intl';
import { CloudOff, TriangleAlert } from 'lucide-react';
import { ErrorState } from '@/components/ui/error-state';
import type { ApiFailure } from '@/lib/api/types';
import { RetryButton } from './retry-button';

/**
 * Renders an API failure (unavailable / error) with a retry action.
 * `not_found` should be handled by the caller with `notFound()`.
 */
export function ApiErrorState({
  failure,
  headingLevel = 'h2',
  className,
}: {
  failure: Pick<ApiFailure, 'kind' | 'requestId'>;
  headingLevel?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  const t = useTranslations('states');
  const tc = useTranslations('common');
  const unavailable = failure.kind === 'unavailable';

  return (
    <ErrorState
      icon={unavailable ? CloudOff : TriangleAlert}
      headingLevel={headingLevel}
      title={unavailable ? t('unavailableTitle') : t('apiErrorTitle')}
      description={unavailable ? t('unavailableDescription') : t('apiErrorDescription')}
      meta={failure.requestId ? tc('requestId', { id: failure.requestId }) : undefined}
      action={<RetryButton />}
      {...(className ? { className } : {})}
    />
  );
}

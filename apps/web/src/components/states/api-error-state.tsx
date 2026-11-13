import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CloudOff, Hourglass, Lock, ShieldX, TriangleAlert } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import type { ApiFailure } from '@/lib/api/types';
import { RetryButton } from './retry-button';

/**
 * Renders an API failure with an appropriate action:
 * unavailable / error → retry; rate_limited → "too many requests, retry shortly";
 * forbidden → no access; unauthenticated → sign in.
 * `not_found` should be handled by the caller with `notFound()`.
 */
export function ApiErrorState({
  failure,
  headingLevel = 'h2',
  className,
}: {
  failure: Pick<ApiFailure, 'kind' | 'requestId' | 'retryAfterSeconds'>;
  headingLevel?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  const t = useTranslations('states');
  const tc = useTranslations('common');
  const ta = useTranslations('auth');
  const meta = failure.requestId ? tc('requestId', { id: failure.requestId }) : undefined;
  const common = {
    headingLevel,
    ...(meta ? { meta } : {}),
    ...(className ? { className } : {}),
  };

  switch (failure.kind) {
    case 'rate_limited':
      return (
        <ErrorState
          {...common}
          icon={Hourglass}
          title={t('rateLimitedTitle')}
          description={
            failure.retryAfterSeconds !== undefined
              ? t('rateLimitedRetryAfter', { seconds: failure.retryAfterSeconds })
              : t('rateLimitedDescription')
          }
          action={<RetryButton />}
        />
      );
    case 'forbidden':
      return (
        <ErrorState
          {...common}
          icon={ShieldX}
          title={t('forbiddenTitle')}
          description={t('forbiddenDescription')}
        />
      );
    case 'unauthenticated':
      return (
        <ErrorState
          {...common}
          icon={Lock}
          title={t('sessionEndedTitle')}
          description={t('sessionEndedDescription')}
          action={
            <Link href="/login" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              {ta('goToLogin')}
            </Link>
          }
        />
      );
    case 'unavailable':
      return (
        <ErrorState
          {...common}
          icon={CloudOff}
          title={t('unavailableTitle')}
          description={t('unavailableDescription')}
          action={<RetryButton />}
        />
      );
    default:
      return (
        <ErrorState
          {...common}
          icon={TriangleAlert}
          title={t('apiErrorTitle')}
          description={t('apiErrorDescription')}
          action={<RetryButton />}
        />
      );
  }
}

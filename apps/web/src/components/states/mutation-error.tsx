'use client';

import { useTranslations } from 'next-intl';
import type { ApiFailure } from '@/lib/api/types';

/**
 * Localised, inline error for a failed mutation (role="alert"). The API's own message is shown
 * only for 400/409, where API_CONVENTIONS documents it as safe to display.
 */
export function MutationError({
  failure,
  conflictMessage,
  className,
}: {
  failure: ApiFailure | null;
  /** Context-specific text for 409. */
  conflictMessage?: string;
  className?: string;
}) {
  const t = useTranslations('mutation');
  const tc = useTranslations('common');
  if (!failure) return null;
  const message =
    failure.kind === 'conflict' && conflictMessage
      ? conflictMessage
      : failure.kind === 'rate_limited' && failure.retryAfterSeconds !== undefined
        ? t('rate_limited_retry', { seconds: failure.retryAfterSeconds })
        : t(failure.kind);
  const serverMessage =
    failure.kind === 'conflict' || failure.kind === 'validation'
      ? failure.serverMessage
      : undefined;
  return (
    <div
      role="alert"
      className={
        className ?? 'space-y-1 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm'
      }
    >
      <p className="font-medium text-danger">{message}</p>
      {serverMessage ? (
        <p className="text-xs text-muted">{t('serverSaid', { message: serverMessage })}</p>
      ) : null}
      {failure.requestId ? (
        <p className="font-mono text-xs text-muted">{tc('requestId', { id: failure.requestId })}</p>
      ) : null}
    </div>
  );
}

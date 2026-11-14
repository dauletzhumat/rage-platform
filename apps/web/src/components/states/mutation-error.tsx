'use client';

import { useTranslations } from 'next-intl';
import { translatableErrorCode } from '@/lib/api/error-codes';
import type { ApiFailure } from '@/lib/api/types';

/**
 * Localised, inline error for a failed mutation (role="alert").
 * Priority: a known `ApiErrorDto.code` (docs/AUTH.md §9a, TEAMS.md §8) → its translated text;
 * otherwise the context-specific 409 text or the generic per-kind text. The API's own (English)
 * message is shown only for 400/409 without a known code, where API_CONVENTIONS documents it as
 * safe to display; 5xx text is never rendered.
 */
export function MutationError({
  failure,
  conflictMessage,
  className,
}: {
  failure: ApiFailure | null;
  /** Context-specific text for 409 without a known code. */
  conflictMessage?: string;
  className?: string;
}) {
  const t = useTranslations('mutation');
  const te = useTranslations('apiErrors');
  const tc = useTranslations('common');
  if (!failure) return null;
  const code = translatableErrorCode(failure);
  const message = code
    ? te(code)
    : failure.kind === 'conflict' && conflictMessage
      ? conflictMessage
      : failure.kind === 'rate_limited' && failure.retryAfterSeconds !== undefined
        ? t('rate_limited_retry', { seconds: failure.retryAfterSeconds })
        : t(failure.kind);
  const serverMessage =
    !code && (failure.kind === 'conflict' || failure.kind === 'validation')
      ? failure.serverMessage
      : undefined;
  return (
    <div
      role="alert"
      data-error-code={code ?? undefined}
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

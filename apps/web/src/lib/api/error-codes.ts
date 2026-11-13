import type { ApiFailure } from './types';

/**
 * Machine-readable `ApiErrorDto.code` values the web app translates
 * (docs/AUTH.md §9a + docs/TEAMS.md §8). Each one has a message under `apiErrors.<CODE>`
 * in every catalog; unknown codes fall back to the generic per-kind message.
 */
export const KNOWN_ERROR_CODES = [
  // M1
  'UNAUTHENTICATED',
  'CSRF_FAILED',
  'FORBIDDEN_ROLE',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'ROLE_ALREADY_GRANTED',
  'LAST_SUPER_ADMIN',
  // M2
  'SAMPLE_RESOURCE',
  'APPLICATION_ALREADY_PENDING',
  'APPLICATION_NOT_PENDING',
  'APPLICANT_IN_TEAM',
  'APPLICANT_INELIGIBLE',
  'TEAM_NAME_TAKEN',
  'TEAM_TAG_TAKEN',
  'TEAM_NOT_ACTIVE',
  'PLAYER_NOT_FOUND',
  'ALREADY_MEMBER',
  'INVITATION_ALREADY_PENDING',
  'INVITATION_LIMIT',
  'INVITATION_NOT_PENDING',
  'INVITATION_EXPIRED',
  'ALREADY_IN_TEAM',
  'ROSTER_FULL',
  'NOT_TEAM_MEMBER',
  'CAPTAIN_MUST_TRANSFER',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_IN_PROGRESS',
] as const;

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

const KNOWN: ReadonlySet<string> = new Set(KNOWN_ERROR_CODES);

export function isKnownErrorCode(code: string | undefined): code is KnownErrorCode {
  return code !== undefined && KNOWN.has(code);
}

/**
 * Codes whose translated text is more useful than the generic per-kind text. Generic transport
 * codes (rate limit, validation, session) keep the kind-based message, which can also carry
 * `Retry-After` or field details.
 */
const KIND_HANDLED: ReadonlySet<KnownErrorCode> = new Set([
  'UNAUTHENTICATED',
  'RATE_LIMITED',
  'VALIDATION_FAILED',
]);

/**
 * The specific translated code for a failure, or null when the caller should use the generic
 * per-kind message. Never returns server-provided text.
 */
export function translatableErrorCode(
  failure: Pick<ApiFailure, 'code' | 'kind' | 'status'>,
): KnownErrorCode | null {
  if (failure.status !== undefined && failure.status >= 500) return null;
  if (!isKnownErrorCode(failure.code)) return null;
  return KIND_HANDLED.has(failure.code) ? null : failure.code;
}

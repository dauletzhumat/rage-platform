/** `?error=` codes the API's Steam callback redirects with (docs/AUTH.md §3.4). */
export const LOGIN_ERROR_CODES = [
  'state_mismatch',
  'cancelled',
  'invalid_assertion',
  'replay',
  'unsupported_account',
  'account_suspended',
  'provider_unavailable',
  'not_configured',
] as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

/**
 * Map a raw `?error=` value to a message key. Unknown values map to `unknown`
 * (generic message) — the raw value is never rendered.
 */
export function loginErrorKey(
  raw: string | string[] | null | undefined,
): LoginErrorCode | 'unknown' | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || value === '') return null;
  return (LOGIN_ERROR_CODES as readonly string[]).includes(value)
    ? (value as LoginErrorCode)
    : 'unknown';
}

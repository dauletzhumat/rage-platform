/** Cookie names and paths (docs/AUTH.md §3–5). */
export const SESSION_COOKIE = 'rage_session';
export const CSRF_COOKIE = 'rage_csrf';
export const OIDC_STATE_COOKIE = 'rage_oidc';
export const OIDC_STATE_COOKIE_PATH = '/api/v1/auth';
export const OIDC_STATE_TTL_SECONDS = 600;

export const CSRF_HEADER = 'x-csrf-token';
export const SSR_TOKEN_HEADER = 'x-rage-ssr-token';
export const SSR_CLIENT_IP_HEADER = 'x-rage-client-ip';

/** `last_seen_at` is written at most this often per session. */
export const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000;

/** HMAC purpose labels (domain separation). */
export const HMAC_PURPOSE_OIDC_STATE = 'rage:oidc-state:v1';
export const HMAC_PURPOSE_CSRF = 'rage:csrf:v1';

/** Login failure codes sent to the web app as `/login?error=<code>`. */
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

export class LoginError extends Error {
  /** Set once an `auth.login_rejected` audit row was written for this error. */
  audited = false;

  constructor(
    readonly code: LoginErrorCode,
    /** Only set once the SteamID was verified by Steam (check_authentication). */
    readonly verifiedSteamId64?: string,
  ) {
    super(`login rejected: ${code}`);
    this.name = 'LoginError';
  }
}

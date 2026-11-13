import { HMAC_PURPOSE_OIDC_STATE, OIDC_STATE_TTL_SECONDS } from './auth.constants.js';
import { hmacBase64Url, safeEqual, TOKEN_PATTERN } from './crypto.js';

/** Relative path only: one leading slash, no `//`, no whitespace, no backslash (AUTH.md §3). */
const RETURN_TO_PATTERN = /^\/(?!\/)[^\s\\]*$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
/**
 * In the path part: `.`/`..` segments and percent-encoded `/`, `\`, `.` are rejected, so the
 * path can never normalize to `//host` (security gate M1, finding L-1).
 */
const UNSAFE_PATH = /(?:^|\/)\.{1,2}(?:\/|$)|%(?:2f|5c|2e)/i;
export const RETURN_TO_MAX_LENGTH = 512;

/**
 * Open-redirect defence: anything that is not a plain same-site relative path becomes `/`.
 * The final redirect is additionally resolved against the web origin and re-checked
 * (`buildWebRedirect`).
 */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (value.length === 0 || value.length > RETURN_TO_MAX_LENGTH) return '/';
  if (CONTROL_CHARS.test(value) || !RETURN_TO_PATTERN.test(value)) return '/';
  if (UNSAFE_PATH.test(value.split(/[?#]/, 1)[0] ?? '')) return '/';
  return value;
}

/** Resolve a sanitized relative path against the web origin; never leaves that origin. */
export function buildWebRedirect(webOrigin: string, returnTo: string): string {
  const safe = sanitizeReturnTo(returnTo);
  try {
    const url = new URL(safe, `${webOrigin}/`);
    if (url.origin === webOrigin && !url.pathname.startsWith('//')) return url.toString();
  } catch {
    // fall through
  }
  return `${webOrigin}/`;
}

export function buildLoginErrorRedirect(webOrigin: string, code: string): string {
  return `${webOrigin}/login?error=${encodeURIComponent(code)}`;
}

interface StatePayload {
  /** state */
  s: string;
  /** returnTo */
  r: string;
  /** expiry, epoch seconds */
  e: number;
}

/** Cookie value: base64url(JSON payload) + "." + base64url(HMAC). */
export function signOidcState(
  secret: string,
  state: string,
  returnTo: string,
  nowMs = Date.now(),
): string {
  const payload: StatePayload = {
    s: state,
    r: sanitizeReturnTo(returnTo),
    e: Math.floor(nowMs / 1000) + OIDC_STATE_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${hmacBase64Url(secret, HMAC_PURPOSE_OIDC_STATE, body)}`;
}

/**
 * Verifies signature, expiry and that `queryState` equals the signed state (constant time).
 * Returns the signed returnTo on success, `undefined` on any failure.
 */
export function verifyOidcState(
  secret: string,
  cookieValue: string | undefined,
  queryState: unknown,
  nowMs = Date.now(),
): { state: string; returnTo: string } | undefined {
  if (!cookieValue || cookieValue.length > 2048 || typeof queryState !== 'string') return undefined;
  const dot = cookieValue.indexOf('.');
  if (dot <= 0 || dot !== cookieValue.lastIndexOf('.')) return undefined;
  const body = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!safeEqual(sig, hmacBase64Url(secret, HMAC_PURPOSE_OIDC_STATE, body))) return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!payload || typeof payload !== 'object') return undefined;
  const { s, r, e } = payload as Partial<StatePayload>;
  if (typeof s !== 'string' || !TOKEN_PATTERN.test(s)) return undefined;
  if (typeof r !== 'string' || typeof e !== 'number') return undefined;
  if (e * 1000 <= nowMs) return undefined;
  if (!safeEqual(s, queryState)) return undefined;
  return { state: s, returnTo: sanitizeReturnTo(r) };
}

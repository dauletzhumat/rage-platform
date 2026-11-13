/** Cookie names set by the API (docs/AUTH.md §4–5). */
export const SESSION_COOKIE = 'rage_session';
export const CSRF_COOKIE = 'rage_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Session/CSRF tokens are base64url (32 bytes → 43 chars). Bound generously, reject anything else. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

export function isWellFormedToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** Read one cookie from a `document.cookie` / `Cookie` header string. */
export function readCookie(cookieString: string | null | undefined, name: string): string | null {
  if (!cookieString) return null;
  for (const part of cookieString.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/**
 * CSRF token for unsafe requests: the JS-readable `rage_csrf` cookie (browser only).
 * Returns null when absent or malformed — callers then let the API reject the request.
 */
export function getCsrfToken(cookieString?: string): string | null {
  const source = cookieString ?? (typeof document === 'undefined' ? '' : document.cookie);
  const token = readCookie(source, CSRF_COOKIE);
  return isWellFormedToken(token) ? token : null;
}

/**
 * Post-login return path sanitisation (open-redirect defence, docs/AUTH.md §3).
 * Mirrors the API rule `^/(?!/)[^\s\\]*$`, max 512 chars. Anything else → `/`.
 * The API re-validates; this only keeps the web app from building bad links.
 */
export const RETURN_TO_MAX_LENGTH = 512;
const RETURN_TO_PATTERN = /^\/(?!\/)[^\s\\]*$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
/** Dot segments and encoded `/`, `\`, `.` in the path part could normalize to `//host`. */
const UNSAFE_PATH = /(?:^|\/)\.{1,2}(?:\/|$)|%(?:2f|5c|2e)/i;

export function safeReturnTo(raw: string | string[] | null | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0) return '/';
  if (value.length > RETURN_TO_MAX_LENGTH) return '/';
  if (CONTROL_CHARS.test(value)) return '/';
  if (!RETURN_TO_PATTERN.test(value)) return '/';
  if (UNSAFE_PATH.test(value.split(/[?#]/, 1)[0] ?? '')) return '/';
  // Never bounce back to the login page itself (avoids loops after sign-in).
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/login/')) return '/';
  return value;
}

/** `/login?returnTo=…` for a (sanitised) path; plain `/login` when it would be `/`. */
export function loginHref(returnTo: string | null | undefined): string {
  const safe = safeReturnTo(returnTo);
  return safe === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(safe)}`;
}

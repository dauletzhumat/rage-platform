/** Header carrying the request path to server components (only used to build a sanitised returnTo). */
export const PATH_HEADER = 'x-rage-path';

/** Routes that need a session; without any session cookie the proxy redirects to /login (UX only). */
export function requiresSessionRedirect(pathname: string): boolean {
  return (
    pathname === '/me' ||
    pathname.startsWith('/me/') ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/')
  );
}

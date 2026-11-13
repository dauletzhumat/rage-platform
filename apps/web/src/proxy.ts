import { NextResponse, type NextRequest } from 'next/server';
import { isWellFormedToken, SESSION_COOKIE } from '@/lib/auth/cookies';
import { PATH_HEADER, requiresSessionRedirect } from '@/lib/auth/paths';
import { loginHref } from '@/lib/auth/return-to';
import { buildContentSecurityPolicy, createNonce, originOf } from '@/lib/security/csp';

/**
 * Per request: generate a CSP nonce (Next applies it to its scripts during SSR),
 * expose the path for returnTo, and short-circuit protected routes when no session
 * cookie exists. Authorization is NEVER decided here — the API is the authority and
 * pages re-check the session through GET /me.
 */
export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const isDev = process.env.NODE_ENV === 'development';
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev,
    apiOrigin: originOf(process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1'),
    upgradeInsecureRequests: (process.env.NEXT_PUBLIC_SITE_URL ?? '').startsWith('https://'),
  });

  const { pathname, search } = request.nextUrl;

  if (
    requiresSessionRedirect(pathname) &&
    !isWellFormedToken(request.cookies.get(SESSION_COOKIE)?.value)
  ) {
    const response = NextResponse.redirect(
      new URL(loginHref(`${pathname}${search}`), request.url),
      307,
    );
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  requestHeaders.set(PATH_HEADER, `${pathname}${search}`.slice(0, 1024));

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};

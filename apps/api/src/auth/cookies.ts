import type { CookieOptions, Response } from 'express';
import type { Env } from '../config/env.js';
import {
  CSRF_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_STATE_COOKIE_PATH,
  OIDC_STATE_TTL_SECONDS,
  SESSION_COOKIE,
} from './auth.constants.js';

const MAX_COOKIE_HEADER = 8192;

/**
 * Minimal RFC 6265 cookie-header parser. First occurrence of a name wins (browsers send
 * the most specific path first). Values are not URL-decoded: every RAGE cookie value is
 * base64url/ASCII. Oversized headers are ignored entirely.
 */
export function parseCookieHeader(header: string | string[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const value = Array.isArray(header) ? header.join('; ') : header;
  if (!value || value.length > MAX_COOKIE_HEADER) return out;
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    let v = part.slice(eq + 1).trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (name && !out.has(name)) out.set(name, v);
  }
  return out;
}

export function readCookie(
  req: { headers: Record<string, string | string[] | undefined> },
  name: string,
): string | undefined {
  return parseCookieHeader(req.headers.cookie).get(name);
}

type CookieEnv = Pick<Env, 'COOKIE_SECURE' | 'SESSION_TTL_HOURS'>;

export function sessionCookieOptions(env: CookieEnv): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    path: '/',
    maxAge: env.SESSION_TTL_HOURS * 3600_000,
  };
}

/** Readable by JS (double-submit), otherwise identical to the session cookie. */
export function csrfCookieOptions(env: CookieEnv): CookieOptions {
  return { ...sessionCookieOptions(env), httpOnly: false };
}

export function oidcStateCookieOptions(env: CookieEnv): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    path: OIDC_STATE_COOKIE_PATH,
    maxAge: OIDC_STATE_TTL_SECONDS * 1000,
  };
}

function expire(options: CookieOptions): CookieOptions {
  const { maxAge: _maxAge, ...rest } = options;
  return { ...rest, expires: new Date(0) };
}

export function setSessionCookies(
  res: Response,
  env: CookieEnv,
  sessionToken: string,
  csrfToken: string,
): void {
  res.cookie(SESSION_COOKIE, sessionToken, sessionCookieOptions(env));
  res.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions(env));
}

export function clearSessionCookies(res: Response, env: CookieEnv): void {
  res.cookie(SESSION_COOKIE, '', expire(sessionCookieOptions(env)));
  res.cookie(CSRF_COOKIE, '', expire(csrfCookieOptions(env)));
}

export function clearOidcStateCookie(res: Response, env: CookieEnv): void {
  res.cookie(OIDC_STATE_COOKIE, '', expire(oidcStateCookieOptions(env)));
}

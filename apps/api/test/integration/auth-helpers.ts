import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppModuleOptions } from '../../src/app.module.js';
import request, { type Response } from 'supertest';
import { OPENID_TRANSPORT } from '../../src/auth/openid-transport.js';
import { StubSteamProvider } from '../support/steam-stub.js';
import { createTestApp } from './helpers.js';

export const WEB = 'http://localhost:3000';
export const SESSION_SECRET_FOR_TESTS = 'test-session-secret-'.padEnd(48, 'x');

export const STEAM_ENV: Record<string, string> = {
  STEAM_OPENID_REALM: 'http://localhost:4000',
  STEAM_OPENID_RETURN_URL: 'http://localhost:4000/api/v1/auth/steam/callback',
  WEB_PUBLIC_URL: WEB,
  SESSION_SECRET: SESSION_SECRET_FOR_TESTS,
  AUTH_RATE_LIMIT_PER_MINUTE: '10000',
};

export async function createAuthTestApp(
  overrides: Record<string, string> = {},
  moduleOptions: AppModuleOptions = {},
): Promise<{ app: NestExpressApplication; op: StubSteamProvider }> {
  const op = new StubSteamProvider();
  const app = await createTestApp({ ...STEAM_ENV, ...overrides }, moduleOptions, (b) =>
    b.overrideProvider(OPENID_TRANSPORT).useValue(op),
  );
  return { app, op };
}

export interface SetCookie {
  name: string;
  value: string;
  attrs: Record<string, string | true>;
  raw: string;
}

export function setCookies(res: Response): Map<string, SetCookie> {
  const header = res.headers['set-cookie'] as unknown;
  const list = Array.isArray(header) ? (header as string[]) : header ? [String(header)] : [];
  const out = new Map<string, SetCookie>();
  for (const raw of list) {
    const [pair = '', ...attrParts] = raw.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const attrs: Record<string, string | true> = {};
    for (const a of attrParts) {
      const i = a.indexOf('=');
      if (i === -1) attrs[a.trim().toLowerCase()] = true;
      else attrs[a.slice(0, i).trim().toLowerCase()] = a.slice(i + 1).trim();
    }
    out.set(name, { name, value: pair.slice(eq + 1), attrs, raw });
  }
  return out;
}

export interface LoginStart {
  stateCookie: string;
  state: string;
  returnTo: string;
  location: URL;
}

export async function startLogin(
  app: NestExpressApplication,
  returnTo?: string,
): Promise<LoginStart> {
  const path =
    returnTo === undefined
      ? '/api/v1/auth/steam'
      : `/api/v1/auth/steam?returnTo=${encodeURIComponent(returnTo)}`;
  const res = await request(app.getHttpServer()).get(path).expect(302);
  const location = new URL(res.headers.location as string);
  const returnToParam = location.searchParams.get('openid.return_to') ?? '';
  const state = new URL(returnToParam).searchParams.get('state') ?? '';
  const cookie = setCookies(res).get('rage_oidc');
  if (!cookie) throw new Error('rage_oidc cookie not set');
  return { stateCookie: cookie.value, state, returnTo: returnToParam, location };
}

export function callbackPath(state: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ state, ...params });
  return `/api/v1/auth/steam/callback?${q.toString()}`;
}

export async function callback(
  app: NestExpressApplication,
  start: LoginStart,
  params: Record<string, string>,
  opts: { cookie?: string | null; userAgent?: string } = {},
): Promise<Response> {
  let req = request(app.getHttpServer()).get(callbackPath(start.state, params));
  const cookie = opts.cookie === undefined ? `rage_oidc=${start.stateCookie}` : opts.cookie;
  if (cookie) req = req.set('Cookie', cookie);
  if (opts.userAgent) req = req.set('User-Agent', opts.userAgent);
  return req;
}

export interface LoggedIn {
  res: Response;
  session: string;
  csrf: string;
  /** Cookie header to send on subsequent requests. */
  cookie: string;
}

/** Full happy-path login through the stubbed OP. */
export async function login(
  app: NestExpressApplication,
  op: StubSteamProvider,
  steamId64: string,
  returnTo?: string,
): Promise<LoggedIn> {
  const start = await startLogin(app, returnTo);
  const res = await callback(app, start, op.assertion(steamId64, start.returnTo));
  const cookies = setCookies(res);
  const session = cookies.get('rage_session')?.value;
  const csrf = cookies.get('rage_csrf')?.value;
  if (res.status !== 302 || !session || !csrf) {
    throw new Error(`login failed: ${res.status} ${String(res.headers.location)}`);
  }
  return { res, session, csrf, cookie: `rage_session=${session}; rage_csrf=${csrf}` };
}

export function errorCodeOf(res: Response): string | null {
  const loc = res.headers.location as string | undefined;
  if (!loc) return null;
  const url = new URL(loc);
  return url.pathname === '/login' ? url.searchParams.get('error') : null;
}

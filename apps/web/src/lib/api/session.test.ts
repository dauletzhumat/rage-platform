import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServerHeaders, clientIpFrom, parseTrustedHops } from './ssr-headers';

/** Incoming request seen by server components (mocked `next/headers`). */
const incoming = vi.hoisted(() => ({
  headers: {} as Record<string, string>,
  cookies: {} as Record<string, string>,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(incoming.headers),
  cookies: async () => ({
    get: (name: string) =>
      name in incoming.cookies ? { name, value: incoming.cookies[name] } : undefined,
  }),
}));

const { getMe, getAdminUsers, getAuditLogs, getTeams } = await import('./server');

const SESSION = 's'.repeat(43);
const ME = {
  user: {
    id: 'u',
    steamId64: '76561198000000001',
    status: 'ACTIVE',
    createdAt: 'x',
    lastLoginAt: null,
  },
  profile: { slug: 'neo', nickname: 'Neo', countryCode: null, biography: null },
  steamProfile: null,
  roles: [],
};

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function callUrl(fetchSpy: ReturnType<typeof vi.fn>, call = 0): string {
  return String((fetchSpy.mock.calls[call] as unknown[] | undefined)?.[0]);
}

function sentHeaders(fetchSpy: ReturnType<typeof vi.fn>, call = 0): Record<string, string> {
  const init = fetchSpy.mock.calls[call]?.[1] as RequestInit;
  return init.headers as Record<string, string>;
}

beforeEach(() => {
  incoming.headers = {};
  incoming.cookies = {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('buildServerHeaders', () => {
  it('adds the SSR token and the visitor IP', () => {
    expect(
      buildServerHeaders({
        ssrToken: 'secret-token',
        forwardedFor: '203.0.113.7, 10.0.0.1',
        realIp: '10.9.9.9',
        trustedHops: 2,
        sessionToken: SESSION,
        withSession: false,
      }),
    ).toEqual({ 'x-rage-ssr-token': 'secret-token', 'x-rage-client-ip': '203.0.113.7' });
  });

  it('omits the token when unset/empty and the IP when unknown', () => {
    expect(
      buildServerHeaders({
        ssrToken: undefined,
        forwardedFor: null,
        realIp: null,
        trustedHops: 1,
        sessionToken: null,
        withSession: true,
      }),
    ).toEqual({});
    expect(
      buildServerHeaders({
        ssrToken: '  ',
        forwardedFor: 'not an ip',
        realIp: undefined,
        trustedHops: 1,
        sessionToken: null,
        withSession: false,
      }),
    ).toEqual({});
  });

  it('forwards only a well-formed rage_session, only when requested', () => {
    const base = { ssrToken: undefined, forwardedFor: null, realIp: null, trustedHops: 0 };
    expect(buildServerHeaders({ ...base, sessionToken: SESSION, withSession: true })).toEqual({
      cookie: `rage_session=${SESSION}`,
    });
    expect(buildServerHeaders({ ...base, sessionToken: SESSION, withSession: false })).toEqual({});
    expect(
      buildServerHeaders({ ...base, sessionToken: `${SESSION}\r\nx: y`, withSession: true }),
    ).toEqual({});
  });

  it('client IP falls back to x-real-ip (only without XFF) and supports IPv6', () => {
    expect(clientIpFrom(null, '2001:db8::1', 1)).toBe('2001:db8::1');
    expect(clientIpFrom('', '', 1)).toBeNull();
    // A malformed trusted hop is NOT papered over with x-real-ip.
    expect(clientIpFrom('garbage<>', '198.51.100.2', 1)).toBeNull();
  });

  it('trusts exactly N proxy hops from the right; 0 trusts nothing (security gate M-2)', () => {
    // Client-supplied "spoof" is left of what the trusted proxy appended.
    expect(clientIpFrom('6.6.6.6, 203.0.113.5', null, 1)).toBe('203.0.113.5');
    expect(clientIpFrom('6.6.6.6, 203.0.113.5, 10.0.0.2', null, 2)).toBe('203.0.113.5');
    expect(clientIpFrom('203.0.113.5', null, 2)).toBeNull();
    expect(clientIpFrom('6.6.6.6, 203.0.113.5', '198.51.100.2', 0)).toBeNull();
    expect(clientIpFrom(null, '198.51.100.2', 0)).toBeNull();
  });

  it('parses WEB_TRUST_PROXY_HOPS defensively', () => {
    expect(parseTrustedHops(undefined)).toBe(0);
    expect(parseTrustedHops('')).toBe(0);
    expect(parseTrustedHops('1')).toBe(1);
    expect(parseTrustedHops(' 2 ')).toBe(2);
    expect(parseTrustedHops('-1')).toBe(0);
    expect(parseTrustedHops('1.5')).toBe(0);
    expect(parseTrustedHops('abc')).toBe(0);
    expect(parseTrustedHops('99')).toBe(10);
  });
});

describe('getMe (session-aware SSR)', () => {
  it('returns unauthenticated WITHOUT a request when there is no session cookie', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await getMe()).toMatchObject({ ok: false, kind: 'unauthenticated' });
    incoming.cookies = { rage_session: 'malformed' };
    expect(await getMe()).toMatchObject({ ok: false, kind: 'unauthenticated' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps 401 to unauthenticated', async () => {
    incoming.cookies = { rage_session: SESSION };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(401, { statusCode: 401, error: 'Unauthorized', message: 'x' })),
    );
    expect(await getMe()).toMatchObject({ ok: false, kind: 'unauthenticated', status: 401 });
  });

  it('forwards only rage_session plus SSR token and client IP', async () => {
    vi.stubEnv('INTERNAL_SSR_TOKEN', 'ssr-secret-value-0123456789abcdef');
    vi.stubEnv('WEB_TRUST_PROXY_HOPS', '2');
    incoming.cookies = { rage_session: SESSION, NEXT_LOCALE: 'ru', rage_csrf: 'c'.repeat(43) };
    incoming.headers = {
      cookie: `rage_session=${SESSION}; NEXT_LOCALE=ru; rage_csrf=${'c'.repeat(43)}`,
      'x-forwarded-for': '203.0.113.9, 10.0.0.2',
    };
    const fetchSpy = vi.fn(async () => json(200, ME));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await getMe();
    expect(result).toEqual({ ok: true, data: ME });
    expect(callUrl(fetchSpy, 0)).toMatch(/\/api\/v1\/me$/);
    expect(sentHeaders(fetchSpy)).toEqual({
      accept: 'application/json',
      'x-rage-ssr-token': 'ssr-secret-value-0123456789abcdef',
      'x-rage-client-ip': '203.0.113.9',
      cookie: `rage_session=${SESSION}`,
    });
  });

  it('omits the SSR token header when INTERNAL_SSR_TOKEN is unset', async () => {
    vi.stubEnv('INTERNAL_SSR_TOKEN', '');
    vi.stubEnv('WEB_TRUST_PROXY_HOPS', '1');
    incoming.cookies = { rage_session: SESSION };
    incoming.headers = { 'x-real-ip': '198.51.100.4' };
    const fetchSpy = vi.fn(async () => json(200, ME));
    vi.stubGlobal('fetch', fetchSpy);
    await getMe();
    const headers = sentHeaders(fetchSpy);
    expect(headers).not.toHaveProperty('x-rage-ssr-token');
    expect(headers['x-rage-client-ip']).toBe('198.51.100.4');
  });

  it('maps 429 to rate_limited with Retry-After', async () => {
    incoming.cookies = { rage_session: SESSION };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(429, { statusCode: 429, message: 'slow down' }, { 'retry-after': '12' }),
      ),
    );
    expect(await getMe()).toMatchObject({
      ok: false,
      kind: 'rate_limited',
      retryAfterSeconds: 12,
    });
  });
});

describe('other server reads', () => {
  it('public reads send SSR headers but never the session cookie', async () => {
    vi.stubEnv('INTERNAL_SSR_TOKEN', 'tok-0123456789abcdef0123456789abcdef');
    vi.stubEnv('WEB_TRUST_PROXY_HOPS', '1');
    incoming.cookies = { rage_session: SESSION };
    incoming.headers = { 'x-forwarded-for': '203.0.113.1' };
    const fetchSpy = vi.fn(async () => json(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    vi.stubGlobal('fetch', fetchSpy);
    await getTeams({ page: 1 });
    const headers = sentHeaders(fetchSpy);
    expect(headers).not.toHaveProperty('cookie');
    expect(headers['x-rage-ssr-token']).toBe('tok-0123456789abcdef0123456789abcdef');
    expect(headers['x-rage-client-ip']).toBe('203.0.113.1');
  });

  it('without WEB_TRUST_PROXY_HOPS a spoofed XFF is never forwarded (gate M-2)', async () => {
    vi.stubEnv('INTERNAL_SSR_TOKEN', 'tok-0123456789abcdef0123456789abcdef');
    vi.stubEnv('WEB_TRUST_PROXY_HOPS', '');
    incoming.headers = { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '6.6.6.7' };
    const fetchSpy = vi.fn(async () => json(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    vi.stubGlobal('fetch', fetchSpy);
    await getTeams({ page: 1 });
    expect(sentHeaders(fetchSpy)).not.toHaveProperty('x-rage-client-ip');
  });

  it('admin reads forward the session and sanitise filters', async () => {
    incoming.cookies = { rage_session: SESSION };
    const fetchSpy = vi.fn(async () => json(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    vi.stubGlobal('fetch', fetchSpy);
    await getAdminUsers({ page: 2, q: 'neo' });
    expect(callUrl(fetchSpy, 0)).toMatch(/\/admin\/users\?page=2&q=neo$/);
    expect(sentHeaders(fetchSpy).cookie).toBe(`rage_session=${SESSION}`);

    await getAuditLogs({ page: 1, action: 'role_grant.create', actorUserId: 'not-a-uuid' });
    expect(callUrl(fetchSpy, 1)).toMatch(/\/admin\/audit\?page=1&action=role_grant\.create$/);
    await getAuditLogs({ action: 'DROP TABLE;' });
    expect(callUrl(fetchSpy, 2)).toMatch(/\/admin\/audit$/);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  parseCookieHeader,
  sessionCookieOptions,
  csrfCookieOptions,
  oidcStateCookieOptions,
} from '../../src/auth/cookies.js';
import {
  hmacBase64Url,
  randomToken,
  safeEqual,
  sha256Hex,
  TOKEN_PATTERN,
} from '../../src/auth/crypto.js';
import { requestOrigin } from '../../src/auth/guards.js';
import {
  buildLoginErrorRedirect,
  buildWebRedirect,
  sanitizeReturnTo,
  signOidcState,
  verifyOidcState,
} from '../../src/auth/oidc-state.js';
import { FetchOpenIdTransport, STEAM_OP_ENDPOINT } from '../../src/auth/openid-transport.js';
import {
  defaultNickname,
  isUuidShaped,
  isValidNickname,
  nicknameFromDisplayName,
  PLAYER_SLUG_PATTERN,
  playerSlugCandidates,
} from '../../src/auth/profile-rules.js';
import { isSessionUsable } from '../../src/auth/session.service.js';
import { normalizeTrackerIp, resolveThrottleTracker } from '../../src/common/http/throttler.js';

const SECRET = 'k'.repeat(43);

describe('crypto helpers', () => {
  it('random tokens are 32 bytes base64url and unique', () => {
    const a = randomToken();
    expect(a).toMatch(TOKEN_PATTERN);
    expect(randomToken()).not.toBe(a);
  });
  it('sha256Hex is stable', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('HMAC purposes are domain-separated', () => {
    expect(hmacBase64Url(SECRET, 'a', 'v')).not.toBe(hmacBase64Url(SECRET, 'b', 'v'));
  });
  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual(undefined, 'abc')).toBe(false);
  });
});

describe('returnTo sanitization (open redirect defence)', () => {
  it.each(['/', '/me', '/teams/rage?tab=roster', '/a/b#c', '/players/a.b', '/search?q=../x'])(
    'keeps %s',
    (v) => {
      expect(sanitizeReturnTo(v)).toBe(v);
    },
  );
  it.each([
    '/..//evil.com',
    '/.//evil.com',
    '/a/../..//evil.com',
    '/..',
    '/%2f%2fevil.com',
    '/%5Cevil.com',
    '/%2e%2e//evil.com',
  ])('rejects dot segments / encoded separators %j (gate L-1)', (v) => {
    expect(sanitizeReturnTo(v)).toBe('/');
    expect(buildWebRedirect('http://localhost:3000', v)).toBe('http://localhost:3000/');
  });
  it.each(['/'])('keeps root %s', (v) => {
    expect(sanitizeReturnTo(v)).toBe(v);
  });
  it.each([
    '//evil.com',
    'https://evil.com',
    'http://evil.com/me',
    '/\\evil',
    '\\\\evil.com',
    '/\\/evil.com',
    'evil.com',
    'javascript:alert(1)',
    '/ /evil',
    '/\tx',
    '/\nLocation: x',
    '/\u0000',
    '',
    `/${'a'.repeat(600)}`,
  ])('rejects %j → /', (v) => {
    expect(sanitizeReturnTo(v)).toBe('/');
  });
  it('rejects non-strings', () => {
    expect(sanitizeReturnTo(['/a', '/b'])).toBe('/');
    expect(sanitizeReturnTo(undefined)).toBe('/');
  });
  it('final redirect never leaves the web origin', () => {
    expect(buildWebRedirect('http://localhost:3000', '/me')).toBe('http://localhost:3000/me');
    expect(buildWebRedirect('http://localhost:3000', '//evil.com')).toBe('http://localhost:3000/');
    expect(buildWebRedirect('http://localhost:3000', 'https://evil.com')).toBe(
      'http://localhost:3000/',
    );
    expect(buildLoginErrorRedirect('http://localhost:3000', 'replay')).toBe(
      'http://localhost:3000/login?error=replay',
    );
  });
});

describe('signed OpenID state cookie', () => {
  const state = randomToken();
  it('round-trips state and returnTo', () => {
    const c = signOidcState(SECRET, state, '/me');
    expect(verifyOidcState(SECRET, c, state)).toEqual({ state, returnTo: '/me' });
  });
  it('rejects a different query state', () => {
    const c = signOidcState(SECRET, state, '/me');
    expect(verifyOidcState(SECRET, c, randomToken())).toBeUndefined();
  });
  it('rejects a missing cookie / missing query state', () => {
    expect(verifyOidcState(SECRET, undefined, state)).toBeUndefined();
    expect(verifyOidcState(SECRET, signOidcState(SECRET, state, '/'), undefined)).toBeUndefined();
  });
  it('rejects tampered payload or signature, and another secret', () => {
    const c = signOidcState(SECRET, state, '/me');
    const [body, sig] = c.split('.') as [string, string];
    const evilBody = Buffer.from(
      JSON.stringify({ s: state, r: '//evil.com', e: 9_999_999_999 }),
    ).toString('base64url');
    expect(verifyOidcState(SECRET, `${evilBody}.${sig}`, state)).toBeUndefined();
    expect(verifyOidcState(SECRET, `${body}.${sig.slice(0, -2)}xx`, state)).toBeUndefined();
    expect(verifyOidcState('z'.repeat(43), c, state)).toBeUndefined();
  });
  it('expires after 10 minutes', () => {
    const now = Date.now();
    const c = signOidcState(SECRET, state, '/me', now);
    expect(verifyOidcState(SECRET, c, state, now + 9 * 60_000)).toBeDefined();
    expect(verifyOidcState(SECRET, c, state, now + 11 * 60_000)).toBeUndefined();
  });
  it('a signed returnTo is re-sanitized on the way out', () => {
    const c = signOidcState(SECRET, state, 'https://evil.com');
    expect(verifyOidcState(SECRET, c, state)?.returnTo).toBe('/');
  });
});

describe('cookies', () => {
  it('parses a cookie header (first value wins, quotes stripped)', () => {
    const m = parseCookieHeader('a=1; rage_session=abc; a=2; b="q"');
    expect(m.get('a')).toBe('1');
    expect(m.get('rage_session')).toBe('abc');
    expect(m.get('b')).toBe('q');
  });
  it('ignores oversized headers', () => {
    expect(parseCookieHeader(`a=${'x'.repeat(9000)}`).size).toBe(0);
  });
  it('flags per AUTH.md §4–5', () => {
    const env = { COOKIE_SECURE: true, SESSION_TTL_HOURS: 336 };
    expect(sessionCookieOptions(env)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 336 * 3600_000,
    });
    expect(csrfCookieOptions(env).httpOnly).toBe(false);
    expect(oidcStateCookieOptions(env)).toMatchObject({
      httpOnly: true,
      path: '/api/v1/auth',
      maxAge: 600_000,
    });
  });
});

describe('session usability', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  const row = {
    createdAt: new Date('2026-11-12T00:00:00Z'),
    lastSeenAt: new Date('2026-11-12T11:00:00Z'),
    expiresAt: new Date('2026-11-20T00:00:00Z'),
    revokedAt: null as Date | null,
  };
  it('usable when active, unexpired, recently seen', () => {
    expect(isSessionUsable(row, 'ACTIVE', now, 72)).toBe(true);
  });
  it('revoked / expired / idle / suspended / banned → unusable', () => {
    expect(isSessionUsable({ ...row, revokedAt: now }, 'ACTIVE', now, 72)).toBe(false);
    expect(isSessionUsable({ ...row, expiresAt: now }, 'ACTIVE', now, 72)).toBe(false);
    expect(
      isSessionUsable({ ...row, lastSeenAt: new Date('2026-11-09T11:59:00Z') }, 'ACTIVE', now, 72),
    ).toBe(false);
    expect(isSessionUsable(row, 'SUSPENDED', now, 72)).toBe(false);
    expect(isSessionUsable(row, 'BANNED', now, 72)).toBe(false);
  });
});

describe('CSRF origin extraction', () => {
  it('prefers Origin, falls back to Referer, rejects "null"', () => {
    expect(requestOrigin({ headers: { origin: 'http://localhost:3000' } })).toBe(
      'http://localhost:3000',
    );
    expect(requestOrigin({ headers: { referer: 'http://localhost:3000/me?x=1' } })).toBe(
      'http://localhost:3000',
    );
    expect(requestOrigin({ headers: { origin: 'null' } })).toBeUndefined();
    expect(requestOrigin({ headers: {} })).toBeUndefined();
    expect(requestOrigin({ headers: { referer: 'garbage' } })).toBeUndefined();
  });
});

describe('profile rules', () => {
  it('nickname validation', () => {
    expect(isValidNickname('Ab')).toBe(true);
    expect(isValidNickname('Игрок_1.x-y z')).toBe(true);
    expect(isValidNickname('a')).toBe(false);
    expect(isValidNickname(' ab')).toBe(false);
    expect(isValidNickname('<script>')).toBe(false);
    expect(isValidNickname('a'.repeat(33))).toBe(false);
  });
  it('display names are only used when valid', () => {
    expect(nicknameFromDisplayName('  s1mple ')).toBe('s1mple');
    expect(nicknameFromDisplayName('admin<img>')).toBeNull();
    expect(nicknameFromDisplayName(null)).toBeNull();
  });
  it('slug candidates are valid, unique, never UUID-shaped', () => {
    const id = '76561198000123456';
    const c = playerSlugCandidates(id);
    expect(c[0]).toBe('player-123456');
    expect(new Set(c).size).toBe(c.length);
    for (const s of c) {
      expect(s).toMatch(PLAYER_SLUG_PATTERN);
      expect(isUuidShaped(s)).toBe(false);
    }
    expect(defaultNickname(id)).toBe('player-123456');
    expect(isUuidShaped('0b6b6c4e-7c0e-4d1b-9a43-0d8b0b0e8a11')).toBe(true);
  });
});

describe('throttle tracker (AUTH.md §8)', () => {
  const TOKEN = 's'.repeat(43);
  it('uses req.ip without an SSR token; spoofed headers are ignored', () => {
    expect(
      resolveThrottleTracker({ ip: '10.0.0.1', headers: { 'x-rage-client-ip': '1.2.3.4' } }, TOKEN),
    ).toBe('10.0.0.1');
    expect(
      resolveThrottleTracker(
        { ip: '10.0.0.1', headers: { 'x-rage-ssr-token': 'wrong', 'x-rage-client-ip': '1.2.3.4' } },
        TOKEN,
      ),
    ).toBe('10.0.0.1');
  });
  it('ignores SSR headers entirely when no INTERNAL_SSR_TOKEN is configured', () => {
    expect(
      resolveThrottleTracker(
        { ip: '10.0.0.1', headers: { 'x-rage-ssr-token': '', 'x-rage-client-ip': '1.2.3.4' } },
        undefined,
      ),
    ).toBe('10.0.0.1');
  });
  it('uses the forwarded client IP with a valid token; invalid IP → ssr bucket', () => {
    const h = { 'x-rage-ssr-token': TOKEN };
    expect(
      resolveThrottleTracker(
        { ip: '10.0.0.1', headers: { ...h, 'x-rage-client-ip': '1.2.3.4' } },
        TOKEN,
      ),
    ).toBe('1.2.3.4');
    expect(
      resolveThrottleTracker(
        { ip: '10.0.0.1', headers: { ...h, 'x-rage-client-ip': 'evil' } },
        TOKEN,
      ),
    ).toBe('ssr');
    expect(resolveThrottleTracker({ ip: '10.0.0.1', headers: h }, TOKEN)).toBe('ssr');
  });
  it('buckets IPv6 by /64 and unwraps IPv4-mapped addresses', () => {
    expect(normalizeTrackerIp('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(normalizeTrackerIp('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(normalizeTrackerIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeTrackerIp('1.2.3.4')).toBe('1.2.3.4');
  });
});

describe('FetchOpenIdTransport', () => {
  it('POSTs form data to Steam with redirect:error and a timeout signal', async () => {
    const fetchImpl = vi.fn(async () => new Response('ns:x\nis_valid:true\n', { status: 200 }));
    const t = new FetchOpenIdTransport(fetchImpl as unknown as typeof fetch);
    const res = await t.checkAuthentication(
      STEAM_OP_ENDPOINT,
      new URLSearchParams({ 'openid.mode': 'check_authentication' }),
    );
    expect(res).toEqual({ status: 200, body: 'ns:x\nis_valid:true\n' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(STEAM_OP_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(String(init.body)).toBe('openid.mode=check_authentication');
  });

  it('refuses any endpoint other than Steam', async () => {
    const fetchImpl = vi.fn();
    const t = new FetchOpenIdTransport(fetchImpl as unknown as typeof fetch);
    await expect(
      t.checkAuthentication('https://evil.example/openid/login', new URLSearchParams()),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects oversized responses', async () => {
    const fetchImpl = vi.fn(async () => new Response('x'.repeat(20_000), { status: 200 }));
    const t = new FetchOpenIdTransport(fetchImpl as unknown as typeof fetch);
    await expect(t.checkAuthentication(STEAM_OP_ENDPOINT, new URLSearchParams())).rejects.toThrow(
      /too large/,
    );
  });

  it('times out', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const t = new FetchOpenIdTransport(fetchImpl as unknown as typeof fetch, 20);
    await expect(t.checkAuthentication(STEAM_OP_ENDPOINT, new URLSearchParams())).rejects.toThrow();
  });
});

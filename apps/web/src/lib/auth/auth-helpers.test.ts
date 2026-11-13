import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import kk from '../../../messages/kk.json';
import ru from '../../../messages/ru.json';
import type { MeDto } from '@/lib/api/types';
import { getCsrfToken, isWellFormedToken, readCookie } from './cookies';
import { LOGIN_ERROR_CODES, loginErrorKey } from './login-errors';
import { requiresSessionRedirect } from './paths';
import { loginHref, safeReturnTo } from './return-to';
import { hasAnyAdminRole, isSuperAdmin, resolveAdminAccess } from './roles';
import { isValidReason, profileFieldOf, validateProfile } from './validation';
import { toViewer } from './viewer';

const TOKEN = 'a'.repeat(43);

describe('cookie / CSRF helpers', () => {
  it('reads a cookie by exact name and decodes it', () => {
    const jar = `NEXT_LOCALE=ru; rage_csrf=${TOKEN}; x_rage_csrf=nope; other=a%20b`;
    expect(readCookie(jar, 'rage_csrf')).toBe(TOKEN);
    expect(readCookie(jar, 'other')).toBe('a b');
    expect(readCookie(jar, 'missing')).toBeNull();
    expect(readCookie('', 'rage_csrf')).toBeNull();
    expect(readCookie(undefined, 'rage_csrf')).toBeNull();
  });

  it('does not match cookies whose name only contains the target', () => {
    expect(readCookie(`x_rage_csrf=${TOKEN}`, 'rage_csrf')).toBeNull();
  });

  it('returns the CSRF token only when well-formed', () => {
    expect(getCsrfToken(`rage_csrf=${TOKEN}`)).toBe(TOKEN);
    expect(getCsrfToken('rage_csrf=short')).toBeNull();
    expect(getCsrfToken('rage_csrf=bad%0D%0Avalue-that-is-long-enough')).toBeNull();
    expect(getCsrfToken('')).toBeNull();
  });

  it('reads document.cookie by default in the browser', () => {
    document.cookie = `rage_csrf=${TOKEN}`;
    expect(getCsrfToken()).toBe(TOKEN);
    document.cookie = 'rage_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('validates token shape', () => {
    expect(isWellFormedToken(TOKEN)).toBe(true);
    expect(isWellFormedToken('abc')).toBe(false);
    expect(isWellFormedToken(`${TOKEN};x=1`)).toBe(false);
    expect(isWellFormedToken(null)).toBe(false);
  });
});

describe('returnTo sanitisation (open-redirect defence)', () => {
  it.each([
    ['//evil.com', '/'],
    ['https://evil.com', '/'],
    ['/\\evil', '/'],
    ['\\\\evil.com', '/'],
    ['/\\/evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['evil.com', '/'],
    ['/ok path', '/'],
    ['/tab\there', '/'],
    ['/line\nbreak', '/'],
    ['', '/'],
    [`/${'a'.repeat(600)}`, '/'],
    ['/login', '/'],
    ['/login?returnTo=/me', '/'],
    // dot segments / encoded separators (security gate M1, L-1)
    ['/..//evil.com', '/'],
    ['/.//evil.com', '/'],
    ['/a/../..//evil.com', '/'],
    ['/..', '/'],
    ['/%2f%2fevil.com', '/'],
    ['/%5cevil.com', '/'],
    ['/%2e%2e//evil.com', '/'],
    ['/me', '/me'],
    ['/players/a.b', '/players/a.b'],
    ['/search?q=../x', '/search?q=../x'],
    ['/admin/users?q=abc&page=2', '/admin/users?q=abc&page=2'],
    ['/teams/sample-falcons/manage', '/teams/sample-falcons/manage'],
  ])('%j → %j', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it('handles missing and array values', () => {
    expect(safeReturnTo(undefined)).toBe('/');
    expect(safeReturnTo(null)).toBe('/');
    expect(safeReturnTo(['/me', '/admin'])).toBe('/me');
  });

  it('builds login links', () => {
    expect(loginHref('/me')).toBe('/login?returnTo=%2Fme');
    expect(loginHref('//evil.com')).toBe('/login');
    expect(loginHref('/')).toBe('/login');
  });
});

describe('login error codes', () => {
  it('maps known codes and hides unknown values', () => {
    for (const code of LOGIN_ERROR_CODES) expect(loginErrorKey(code)).toBe(code);
    expect(loginErrorKey('<script>')).toBe('unknown');
    expect(loginErrorKey(['cancelled'])).toBe('cancelled');
    expect(loginErrorKey(undefined)).toBeNull();
    expect(loginErrorKey('')).toBeNull();
  });

  it.each([
    ['en', en],
    ['ru', ru],
    ['kk', kk],
  ])('%s has a message for every code', (_locale, messages) => {
    const errors = messages.auth.errors as Record<string, string>;
    for (const code of [...LOGIN_ERROR_CODES, 'unknown']) {
      expect(errors[code], code).toBeTruthy();
    }
  });
});

function me(roles: Array<[MeDto['roles'][number]['role'], MeDto['roles'][number]['scopeType']]>) {
  return {
    user: {
      id: '0195f1d2-0000-7000-8000-000000000001',
      steamId64: '76561198000000001',
      status: 'ACTIVE',
      createdAt: '2026-11-12T00:00:00.000Z',
      lastLoginAt: null,
    },
    profile: { slug: 'neo', nickname: 'Neo', countryCode: null, biography: null },
    steamProfile: null,
    roles: roles.map(([role, scopeType], i) => ({
      id: `r${i}`,
      role,
      scopeType,
      scopeId: null,
      issuedAt: '2026-11-12T00:00:00.000Z',
    })),
  } satisfies MeDto;
}

describe('admin guard logic', () => {
  it('redirects to login without a session', () => {
    expect(resolveAdminAccess({ ok: false, kind: 'unauthenticated', message: 'x' })).toEqual({
      kind: 'redirect_login',
    });
  });

  it('forbids signed-in users without an admin role', () => {
    expect(resolveAdminAccess({ ok: true, data: me([]) }).kind).toBe('forbidden');
    expect(resolveAdminAccess({ ok: true, data: me([['OBSERVER', 'GLOBAL']]) }).kind).toBe(
      'forbidden',
    );
    expect(resolveAdminAccess({ ok: true, data: me([['TEAM_MANAGER', 'TEAM']]) }).kind).toBe(
      'forbidden',
    );
  });

  it('allows admin roles and flags super admins', () => {
    const tournament = resolveAdminAccess({ ok: true, data: me([['TOURNAMENT_ADMIN', 'GLOBAL']]) });
    expect(tournament).toMatchObject({ kind: 'allowed', superAdmin: false });
    const superAdmin = resolveAdminAccess({ ok: true, data: me([['SUPER_ADMIN', 'GLOBAL']]) });
    expect(superAdmin).toMatchObject({ kind: 'allowed', superAdmin: true });
  });

  it('surfaces API failures (incl. 429) instead of guessing', () => {
    const access = resolveAdminAccess({ ok: false, kind: 'rate_limited', message: 'x' });
    expect(access).toMatchObject({ kind: 'failure', result: { kind: 'rate_limited' } });
  });

  it('role helpers', () => {
    expect(hasAnyAdminRole([{ role: 'MATCH_ADMIN' }])).toBe(true);
    expect(hasAnyAdminRole([{ role: 'OBSERVER' }])).toBe(false);
    expect(isSuperAdmin([{ role: 'SUPER_ADMIN', scopeType: 'TEAM' }])).toBe(false);
  });

  it('protected redirect paths', () => {
    for (const p of ['/me', '/me/invitations', '/admin', '/admin/users']) {
      expect(requiresSessionRedirect(p)).toBe(true);
    }
    for (const p of ['/', '/mesh', '/administrator', '/teams/apply', '/login']) {
      expect(requiresSessionRedirect(p)).toBe(false);
    }
  });
});

describe('viewer mapping', () => {
  it('keeps only allowlisted Steam avatars', () => {
    const data = me([['SUPER_ADMIN', 'GLOBAL']]);
    expect(
      toViewer({
        ...data,
        steamProfile: {
          displayName: 'n',
          avatarUrl: 'https://avatars.steamstatic.com/abc_full.jpg',
          profileUrl: null,
        },
      }),
    ).toEqual({
      nickname: 'Neo',
      slug: 'neo',
      avatarUrl: 'https://avatars.steamstatic.com/abc_full.jpg',
      isAdmin: true,
    });
    for (const bad of [
      'http://avatars.steamstatic.com/a.jpg',
      'https://evil.com/a.jpg',
      'https://avatars.steamstatic.com.evil.com/a.jpg',
      'javascript:alert(1)',
    ]) {
      expect(
        toViewer({ ...data, steamProfile: { displayName: null, avatarUrl: bad, profileUrl: null } })
          .avatarUrl,
      ).toBeNull();
    }
  });
});

describe('profile validation (mirrors docs/AUTH.md §9)', () => {
  it('normalises valid input', () => {
    expect(validateProfile({ nickname: '  Neo_1 ', countryCode: 'kz', biography: '  ' })).toEqual({
      ok: true,
      value: { nickname: 'Neo_1', countryCode: 'KZ', biography: null },
    });
    expect(validateProfile({ nickname: 'Қайрат', countryCode: '', biography: 'hi' })).toMatchObject(
      {
        ok: true,
        value: { countryCode: null, biography: 'hi' },
      },
    );
  });

  it('rejects invalid fields with codes', () => {
    expect(
      validateProfile({ nickname: 'a', countryCode: 'K1', biography: 'x'.repeat(501) }),
    ).toEqual({
      ok: false,
      errors: {
        nickname: 'nicknameLength',
        countryCode: 'countryFormat',
        biography: 'biographyLength',
      },
    });
    expect(validateProfile({ nickname: 'bad<name>', countryCode: '', biography: '' })).toEqual({
      ok: false,
      errors: { nickname: 'nicknameChars' },
    });
    expect(
      validateProfile({ nickname: 'x'.repeat(33), countryCode: 'KZZ', biography: '' }),
    ).toMatchObject({
      ok: false,
      errors: { nickname: 'nicknameLength', countryCode: 'countryFormat' },
    });
  });

  it('reason length 3–500 and API field mapping', () => {
    expect(isValidReason('  ok ')).toBe(false);
    expect(isValidReason('fine')).toBe(true);
    expect(isValidReason('x'.repeat(501))).toBe(false);
    expect(profileFieldOf('nickname')).toBe('nickname');
    expect(profileFieldOf('biography.length')).toBe('biography');
    expect(profileFieldOf('(root)')).toBeNull();
  });
});

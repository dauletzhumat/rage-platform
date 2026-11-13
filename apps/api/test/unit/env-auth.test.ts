import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../../src/config/env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};
const SECRET = 'x'.repeat(43);
const steam = {
  ...base,
  API_CORS_ORIGINS: 'http://localhost:3000',
  STEAM_OPENID_REALM: 'http://localhost:4000',
  STEAM_OPENID_RETURN_URL: 'http://localhost:4000/api/v1/auth/steam/callback',
  WEB_PUBLIC_URL: 'http://localhost:3000',
  SESSION_SECRET: SECRET,
};
const prodSteam = {
  ...steam,
  NODE_ENV: 'production',
  API_CORS_ORIGINS: 'https://rage.example',
  STEAM_OPENID_REALM: 'https://rage.example',
  STEAM_OPENID_RETURN_URL: 'https://rage.example/api/v1/auth/steam/callback',
  WEB_PUBLIC_URL: 'https://rage.example',
  INTERNAL_SSR_TOKEN: 'y'.repeat(43),
};

function issuesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(EnvValidationError);
    return (err as EnvValidationError).issues.map((i) => i.key);
  }
  throw new Error('expected EnvValidationError');
}

describe('parseEnv — Steam sign-in & sessions (AUTH.md §2, SEC-M0-L6)', () => {
  it('defaults: unconfigured, 336/72 h, cookies not Secure outside production, auth limit 20', () => {
    const env = parseEnv(base);
    expect(env.steamAuth).toBeNull();
    expect(env.SESSION_TTL_HOURS).toBe(336);
    expect(env.SESSION_IDLE_HOURS).toBe(72);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.AUTH_RATE_LIMIT_PER_MINUTE).toBe(20);
    expect(env.WEB_PUBLIC_URL).toBe('http://localhost:3000');
  });

  it('is configured when realm, return URL, web URL and secret are valid (normalized)', () => {
    const env = parseEnv({ ...steam, STEAM_OPENID_REALM: 'http://localhost:4000/' });
    expect(env.steamAuth).toEqual({
      realm: 'http://localhost:4000',
      returnUrl: 'http://localhost:4000/api/v1/auth/steam/callback',
      webPublicUrl: 'http://localhost:3000',
      sessionSecret: SECRET,
    });
  });

  it('COOKIE_SECURE=true can be forced outside production', () => {
    expect(parseEnv({ ...base, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
  });

  it('stays unconfigured (no error) while a piece is missing; empty strings count as unset', () => {
    expect(parseEnv({ ...steam, SESSION_SECRET: '' }).steamAuth).toBeNull();
    expect(parseEnv({ ...steam, STEAM_OPENID_REALM: undefined }).steamAuth).toBeNull();
    expect(parseEnv({ ...steam, STEAM_OPENID_RETURN_URL: '' }).steamAuth).toBeNull();
  });

  it.each([
    ['http://localhost:4000/path'],
    ['http://localhost:4000/?q=1'],
    ['http://localhost:4000/#frag'],
    ['http://user:pw@localhost:4000'],
    ['ftp://localhost:4000'],
    ['not a url'],
  ])('rejects malformed realm %s', (realm) => {
    expect(issuesOf(() => parseEnv({ ...steam, STEAM_OPENID_REALM: realm }))).toContain(
      'STEAM_OPENID_REALM',
    );
  });

  it.each([
    ['http://localhost:4000/api/v1/auth/steam/other'],
    ['http://localhost:4000/api/v1/auth/steam/callback?x=1'],
    ['http://localhost:4000/api/v1/auth/steam/callback#x'],
    ['/api/v1/auth/steam/callback'],
  ])('rejects malformed return URL %s', (url) => {
    expect(issuesOf(() => parseEnv({ ...steam, STEAM_OPENID_RETURN_URL: url }))).toContain(
      'STEAM_OPENID_RETURN_URL',
    );
  });

  it.each([
    ['http://evil.example:4000/api/v1/auth/steam/callback'],
    ['http://localhost:4001/api/v1/auth/steam/callback'],
    ['https://localhost:4000/api/v1/auth/steam/callback'],
  ])('rejects a return URL outside the realm: %s', (url) => {
    expect(issuesOf(() => parseEnv({ ...steam, STEAM_OPENID_RETURN_URL: url }))).toContain(
      'STEAM_OPENID_RETURN_URL',
    );
  });

  it('rejects short secrets', () => {
    expect(issuesOf(() => parseEnv({ ...steam, SESSION_SECRET: 'short' }))).toContain(
      'SESSION_SECRET',
    );
    expect(issuesOf(() => parseEnv({ ...base, INTERNAL_SSR_TOKEN: 'short' }))).toContain(
      'INTERNAL_SSR_TOKEN',
    );
  });

  it.each([['76561190000000001'], ['123'], ['7656119800000000x']])(
    'rejects bootstrap SteamID %s (sample / malformed)',
    (id) => {
      expect(issuesOf(() => parseEnv({ ...base, BOOTSTRAP_SUPER_ADMIN_STEAM_ID64: id }))).toContain(
        'BOOTSTRAP_SUPER_ADMIN_STEAM_ID64',
      );
    },
  );

  it('accepts an individual bootstrap SteamID', () => {
    expect(
      parseEnv({ ...base, BOOTSTRAP_SUPER_ADMIN_STEAM_ID64: '76561198000000001' })
        .BOOTSTRAP_SUPER_ADMIN_STEAM_ID64,
    ).toBe('76561198000000001');
  });

  it('requires WEB_PUBLIC_URL to be an origin listed in API_CORS_ORIGINS', () => {
    expect(
      issuesOf(() => parseEnv({ ...steam, WEB_PUBLIC_URL: 'http://localhost:3000/app' })),
    ).toContain('WEB_PUBLIC_URL');
    expect(
      issuesOf(() => parseEnv({ ...steam, API_CORS_ORIGINS: 'http://other.example:3000' })),
    ).toContain('WEB_PUBLIC_URL');
  });

  it('rejects idle timeout longer than the absolute TTL', () => {
    expect(
      issuesOf(() => parseEnv({ ...base, SESSION_TTL_HOURS: '10', SESSION_IDLE_HOURS: '11' })),
    ).toContain('SESSION_IDLE_HOURS');
  });

  it('production: valid config passes; cookies Secure by default', () => {
    const env = parseEnv(prodSteam);
    expect(env.steamAuth?.realm).toBe('https://rage.example');
    expect(env.COOKIE_SECURE).toBe(true);
  });

  it('production: rejects http realm / return URL / web URL', () => {
    const keys = issuesOf(() =>
      parseEnv({
        ...prodSteam,
        STEAM_OPENID_REALM: 'http://rage.example',
        STEAM_OPENID_RETURN_URL: 'http://rage.example/api/v1/auth/steam/callback',
        WEB_PUBLIC_URL: 'http://rage.example',
      }),
    );
    expect(keys).toEqual(
      expect.arrayContaining(['STEAM_OPENID_REALM', 'STEAM_OPENID_RETURN_URL', 'WEB_PUBLIC_URL']),
    );
  });

  it('production: requires SESSION_SECRET and INTERNAL_SSR_TOKEN even without Steam config', () => {
    const keys = issuesOf(() =>
      parseEnv({ ...base, NODE_ENV: 'production', API_CORS_ORIGINS: 'https://rage.example' }),
    );
    expect(keys).toEqual(expect.arrayContaining(['SESSION_SECRET', 'INTERNAL_SSR_TOKEN']));
  });

  it('production: rejects API_DOCS_ENABLED=true and COOKIE_SECURE=false', () => {
    expect(issuesOf(() => parseEnv({ ...prodSteam, API_DOCS_ENABLED: 'true' }))).toContain(
      'API_DOCS_ENABLED',
    );
    expect(issuesOf(() => parseEnv({ ...prodSteam, COOKIE_SECURE: 'false' }))).toContain(
      'COOKIE_SECURE',
    );
  });

  it('never echoes secret values in errors', () => {
    try {
      parseEnv({ ...steam, SESSION_SECRET: 'TOPSECRETVALUE' });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('TOPSECRETVALUE');
    }
  });
});

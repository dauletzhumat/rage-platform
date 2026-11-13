import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../../src/config/env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv', () => {
  it('applies safe defaults', () => {
    const env = parseEnv(base);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.API_DOCS_ENABLED).toBe(false);
    expect(env.API_CORS_ORIGINS).toEqual([]);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
  });

  it('treats empty strings as unset', () => {
    const env = parseEnv({ ...base, API_PORT: '', STEAM_OPENID_REALM: '' });
    expect(env.API_PORT).toBe(4000);
    expect(env.STEAM_OPENID_REALM).toBeUndefined();
  });

  it('parses CORS origin lists and booleans', () => {
    const env = parseEnv({
      ...base,
      API_CORS_ORIGINS: 'http://localhost:3000, https://rage.example',
      API_DOCS_ENABLED: 'true',
    });
    expect(env.API_CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://rage.example']);
    expect(env.API_DOCS_ENABLED).toBe(true);
  });

  it('rejects missing or malformed connection strings without echoing values', () => {
    try {
      parseEnv({ DATABASE_URL: 'mysql://secret-user:secret-pass@x/db' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain('DATABASE_URL');
      expect(msg).toContain('REDIS_URL');
      expect(msg).not.toContain('secret-pass');
    }
  });

  it('rejects invalid CORS origins', () => {
    expect(() => parseEnv({ ...base, API_CORS_ORIGINS: 'not a url' })).toThrow(EnvValidationError);
  });

  it('requires https CORS origins in production', () => {
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'production', API_CORS_ORIGINS: 'http://rage.example' }),
    ).toThrow(/https/);
    expect(
      parseEnv({
        ...base,
        SESSION_SECRET: 's'.repeat(43),
        INTERNAL_SSR_TOKEN: 't'.repeat(43),
        NODE_ENV: 'production',
        API_CORS_ORIGINS: 'https://rage.example',
      }).API_CORS_ORIGINS,
    ).toEqual(['https://rage.example']);
  });

  it('rejects out-of-range ports', () => {
    expect(() => parseEnv({ ...base, API_PORT: '70000' })).toThrow(EnvValidationError);
  });
});

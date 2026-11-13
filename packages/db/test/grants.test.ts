import { describe, expect, it } from 'vitest';
import {
  APPEND_ONLY_TABLES,
  DEFAULT_APP_ROLE,
  NO_ACCESS_TABLES,
  scramSha256Verifier,
  toPgConnectionString,
  validateAppPassword,
  validateAppRoleName,
} from '../prisma/grants.js';
import { ownerDatabaseUrl } from '../prisma/load-env.js';

describe('db:grants input validation', () => {
  it('accepts valid role names and the default', () => {
    expect(validateAppRoleName(DEFAULT_APP_ROLE)).toBe('rage_app');
    expect(validateAppRoleName('_x1')).toBe('_x1');
    expect(validateAppRoleName('a'.repeat(63))).toHaveLength(63);
  });

  it.each([
    '',
    'Rage',
    '1rage',
    'rage-app',
    'rage app',
    'a'.repeat(64),
    'pg_app',
    'public',
    'x";drop',
  ])('rejects role name %j', (name) => {
    expect(() => validateAppRoleName(name)).toThrow(/RAGE_APP_DB_ROLE/);
  });

  it('requires a non-empty printable-ASCII password and never echoes it', () => {
    const secret = 'short-secret';
    expect(() => validateAppPassword(undefined)).toThrow(/required/);
    expect(() => validateAppPassword('')).toThrow(/required/);
    expect(() => validateAppPassword('abc')).toThrow(/characters long/);
    expect(() => validateAppPassword('x'.repeat(257))).toThrow(/characters long/);
    expect(() => validateAppPassword('has space inside')).toThrow(/printable ASCII/);
    expect(() => validateAppPassword('pässwörd-long-enough')).toThrow(/printable ASCII/);
    try {
      validateAppPassword('bad pw ' + secret);
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(secret);
    }
    expect(validateAppPassword('rage_app_dev_password')).toBe('rage_app_dev_password');
  });
});

describe('scramSha256Verifier', () => {
  it('has the PostgreSQL verifier format and is deterministic for a fixed salt', () => {
    // Inputs from RFC 7677 §3: password "pencil", salt W22ZaJ0SNY7soEsUEjb6gQ==, i=4096.
    const v = scramSha256Verifier(
      'pencil',
      Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64'),
      4096,
    );
    const [, rest] = v.split('$4096:');
    expect(v.startsWith('SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$')).toBe(true);
    // ServerKey is derivable from the RFC's ServerSignature only with the AuthMessage, so
    // assert the format and determinism here; the integration test proves a real login works.
    expect(rest).toMatch(/^[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/);
    expect(scramSha256Verifier('pencil', Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64'))).toBe(
      v,
    );
  });

  it('uses a random salt by default and does not contain the password', () => {
    const a = scramSha256Verifier('rage_app_dev_password');
    const b = scramSha256Verifier('rage_app_dev_password');
    expect(a).not.toBe(b);
    expect(a).not.toContain('rage_app_dev_password');
  });
});

describe('connection helpers', () => {
  it('prefers MIGRATION_DATABASE_URL over DATABASE_URL, ignoring empty values', () => {
    expect(
      ownerDatabaseUrl({
        MIGRATION_DATABASE_URL: 'postgresql://o@h/db',
        DATABASE_URL: 'postgresql://a@h/db',
      }),
    ).toBe('postgresql://o@h/db');
    expect(
      ownerDatabaseUrl({ MIGRATION_DATABASE_URL: '', DATABASE_URL: 'postgresql://a@h/db' }),
    ).toBe('postgresql://a@h/db');
    expect(() => ownerDatabaseUrl({})).toThrow(/MIGRATION_DATABASE_URL/);
  });

  it('strips ?schema=public and rejects other schemas', () => {
    expect(toPgConnectionString('postgresql://u:p@h:5432/db?schema=public')).toBe(
      'postgresql://u:p@h:5432/db',
    );
    expect(() => toPgConnectionString('postgresql://u:p@h:5432/db?schema=other')).toThrow(/public/);
  });

  it('restricts the append-only and migration tables', () => {
    expect([...APPEND_ONLY_TABLES].sort()).toEqual(['audit_logs', 'match_events']);
    expect(NO_ACCESS_TABLES).toEqual(['_prisma_migrations']);
  });
});

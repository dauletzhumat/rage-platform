import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrismaClient, parseDatabaseUrl } from '../src/client.js';
import { DB_CONSTRAINTS } from '../src/constraints.js';
import { getDbViolation, isUniqueViolation } from '../src/errors.js';
import { assertSampleSeedAllowed } from '../prisma/seed-sample.js';

describe('parseDatabaseUrl', () => {
  it('strips the Prisma ?schema= parameter and returns it separately', () => {
    const r = parseDatabaseUrl(
      'postgresql://u:p@127.0.0.1:5432/rage?schema=public&sslmode=disable',
    );
    expect(r.schema).toBe('public');
    expect(r.connectionString).toBe('postgresql://u:p@127.0.0.1:5432/rage?sslmode=disable');
  });

  it('accepts URLs without a schema', () => {
    expect(parseDatabaseUrl('postgres://u@h/db').schema).toBeUndefined();
  });

  it('rejects non-postgres and malformed URLs without echoing credentials', () => {
    expect(() => parseDatabaseUrl('mysql://u:secret@h/db')).toThrow(/postgresql:\/\//);
    expect(() => parseDatabaseUrl('not a url secret')).toThrow('DATABASE_URL is not a valid URL');
  });
});

describe('createPrismaClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws a clear error when no database URL is available', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(() => createPrismaClient()).toThrow(/DATABASE_URL is not set/);
  });

  it('constructs a client lazily without connecting', async () => {
    const client = createPrismaClient({
      databaseUrl: 'postgresql://u:p@127.0.0.1:1/none?schema=public',
    });
    expect(typeof client.user.findMany).toBe('function');
    await client.$disconnect();
  });
});

describe('getDbViolation', () => {
  const adapterError = (cause: Record<string, unknown>, code = 'P2039') => ({
    code,
    meta: { driverAdapterError: { name: 'DriverAdapterError', cause } },
  });

  it('maps unique violations using the structured constraint index', () => {
    const err = adapterError(
      {
        originalCode: '23505',
        originalMessage: 'duplicate key value violates unique constraint "users_steam_id64_key"',
        kind: 'UniqueConstraintViolation',
        constraint: { index: 'users_steam_id64_key' },
        table: 'users',
      },
      'P2002',
    );
    expect(getDbViolation(err)).toEqual({
      kind: 'unique',
      constraint: DB_CONSTRAINTS.userSteamIdUnique,
      sqlState: '23505',
      prismaCode: 'P2002',
      table: 'users',
    });
    expect(isUniqueViolation(err, DB_CONSTRAINTS.userSteamIdUnique)).toBe(true);
    expect(isUniqueViolation(err, DB_CONSTRAINTS.teamSlugUnique)).toBe(false);
  });

  it('maps CHECK violations by parsing the message', () => {
    const v = getDbViolation(
      adapterError({
        originalCode: '23514',
        originalMessage:
          'new row for relation "users" violates check constraint "users_steam_id64_format_chk"',
      }),
    );
    expect(v?.kind).toBe('check');
    expect(v?.constraint).toBe(DB_CONSTRAINTS.userSteamIdFormat);
  });

  it('maps append-only trigger rejections', () => {
    const v = getDbViolation(
      adapterError({
        originalCode: 'P0001',
        originalMessage: 'rage: table "audit_logs" is append-only; UPDATE is not allowed',
      }),
    );
    expect(v?.kind).toBe('append_only');
  });

  it('returns undefined for non-database errors', () => {
    expect(getDbViolation(new Error('boom'))).toBeUndefined();
    expect(getDbViolation(null)).toBeUndefined();
    expect(getDbViolation('x')).toBeUndefined();
  });
});

describe('seed:sample guard', () => {
  it('refuses to run in production', () => {
    expect(() => assertSampleSeedAllowed({ NODE_ENV: 'production' })).toThrow(/production/);
    expect(() => assertSampleSeedAllowed({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertSampleSeedAllowed({})).not.toThrow();
  });
});

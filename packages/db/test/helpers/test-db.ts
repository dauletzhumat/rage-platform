import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createPrismaClient, type PrismaClient } from '../../src/index.js';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const PRISMA_CLI = path.join(PACKAGE_ROOT, 'node_modules', 'prisma', 'build', 'index.js');

function loadRootEnv(): void {
  const rootEnv = path.resolve(PACKAGE_ROOT, '..', '..', '.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
}

/** Returns TEST_DATABASE_URL, refusing anything whose database name does not end with "_test". */
export function getTestDatabaseUrl(): string {
  loadRootEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error(
      'TEST_DATABASE_URL is not set; integration tests need a dedicated *_test database',
    );
  const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run destructive integration tests against database "${dbName}" (name must end with "_test")`,
    );
  }
  return url;
}

function pgConnectionString(url: string): string {
  const u = new URL(url);
  u.searchParams.delete('schema');
  return u.toString();
}

/** Runs the Prisma CLI against the test database. Returns stdout. */
export function runPrismaCli(args: string[], url = getTestDatabaseUrl()): string {
  return execFileSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Drops and recreates the `public` schema of the *_test database, then applies all migrations. */
export async function resetAndMigrateTestDatabase(): Promise<void> {
  const url = getTestDatabaseUrl();
  const client = new pg.Client({ connectionString: pgConnectionString(url) });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  runPrismaCli(['migrate', 'deploy']);
}

export async function withPgClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: pgConnectionString(getTestDatabaseUrl()) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export function createTestPrisma(): PrismaClient {
  return createPrismaClient({ databaseUrl: getTestDatabaseUrl(), poolMax: 4 });
}

let steamCounter = 0;
/** Unique, well-formed SteamID64 in the individual range (test-only; not a real verified login). */
export function uniqueSteamId64(): string {
  steamCounter += 1;
  const base = 76561198000000000n;
  const salt = BigInt(Date.now() % 1_000_000) * 1000n + BigInt(steamCounter % 1000);
  return (base + salt).toString();
}

let seq = 0;
export function uniqueSuffix(): string {
  seq += 1;
  return `${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Collects every message/code/meta in an error chain so assertions can find constraint names. */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as { message?: unknown; code?: unknown; meta?: unknown; cause?: unknown };
    parts.push(String(e.message ?? ''), String(e.code ?? ''));
    try {
      parts.push(JSON.stringify(e.meta ?? null));
    } catch {
      // ignore
    }
    current = e.cause;
  }
  return parts.join(' | ');
}

/** Asserts the promise rejects and that the error chain mentions `pattern`. */
export async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const text = describeError(error);
    if (!pattern.test(text)) {
      throw new Error(`Expected DB error matching ${pattern}, got: ${text}`, { cause: error });
    }
    return text;
  }
  throw new Error(`Expected DB error matching ${pattern}, but the operation succeeded`);
}

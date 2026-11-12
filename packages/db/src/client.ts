import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  /** Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
  /** Prisma log levels emitted to stdout (default: none). */
  log?: Prisma.LogLevel[];
  /** Max pool connections for the underlying `pg.Pool` (default: pg's default, 10). */
  poolMax?: number;
}

/**
 * Extracts the Postgres schema from a Prisma-style URL (`?schema=...`) and returns a
 * connection string without that parameter (node-postgres does not understand it).
 */
export function parseDatabaseUrl(databaseUrl: string): {
  connectionString: string;
  schema: string | undefined;
} {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`DATABASE_URL must use the postgresql:// scheme, got "${url.protocol}"`);
  }
  const schema = url.searchParams.get('schema') ?? undefined;
  url.searchParams.delete('schema');
  return { connectionString: url.toString(), schema: schema || undefined };
}

/**
 * Creates a PrismaClient wired to PostgreSQL via `@prisma/adapter-pg` (required in Prisma 7).
 * The caller owns the lifecycle: call `$disconnect()` on shutdown.
 */
export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set (and no databaseUrl option was provided)');
  }
  const { connectionString, schema } = parseDatabaseUrl(databaseUrl);
  const adapter = new PrismaPg(
    { connectionString, ...(options.poolMax !== undefined ? { max: options.poolMax } : {}) },
    schema ? { schema } : undefined,
  );
  return new PrismaClient({ adapter, log: options.log ?? [] });
}

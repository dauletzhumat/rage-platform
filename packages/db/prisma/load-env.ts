import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Loads the repo-root .env for CLI entrypoints (seeds). Variables already present in the
 * environment win (process.loadEnvFile never overrides). The library (src/) never reads .env.
 */
export function loadRootEnv(): void {
  const rootEnv = path.resolve(import.meta.dirname, '..', '..', '..', '.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
}

/**
 * Connection URL for owner-level CLI entrypoints (seeds, db:grants): MIGRATION_DATABASE_URL
 * if set (non-empty), else DATABASE_URL. The API runtime never uses this (ADR-016).
 */
export function ownerDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.MIGRATION_DATABASE_URL || env.DATABASE_URL;
  if (!url) throw new Error('Set MIGRATION_DATABASE_URL (owner) or DATABASE_URL');
  return url;
}

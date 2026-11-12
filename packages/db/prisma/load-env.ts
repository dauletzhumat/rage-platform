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

// Prisma 7 CLI configuration (datasource URL lives here, not in schema.prisma).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Load the repo-root .env (if present) without overriding variables already set in the
// environment (CI / containers / test harness take precedence). `dotenv` is not used.
const here = import.meta.dirname ?? process.cwd();
const rootEnv = path.resolve(here, '../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // The Prisma CLI (migrate deploy/status/diff) connects as the database OWNER:
    // MIGRATION_DATABASE_URL wins and DATABASE_URL is the fallback. The API runtime keeps
    // using DATABASE_URL, which points at the least-privilege application role (ADR-016).
    // Optional so that `prisma generate` works without a database URL.
    url: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  },
});

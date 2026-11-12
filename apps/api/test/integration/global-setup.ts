import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrismaClient } from '@rage/db';
import { loadDotEnvForDevelopment } from '../../src/config/env.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Prepares a FRESH test database: drops and recreates the `public` schema of the
 * database named in TEST_DATABASE_URL (refuses unless its name ends in `_test`),
 * then applies all Prisma migrations exactly as production would (`migrate deploy`).
 */
export default async function setup(): Promise<void> {
  loadDotEnvForDevelopment(repoRoot);
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required for integration tests');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset database "${dbName}": name must end with "_test"`);
  }

  const prisma = createPrismaClient({ databaseUrl: url });
  try {
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  } finally {
    await prisma.$disconnect();
  }

  // Fixed command string (no interpolated input); a shell is needed for pnpm.cmd on Windows.
  execSync('pnpm --filter @rage/db exec prisma migrate deploy', {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}

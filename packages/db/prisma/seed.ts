/**
 * Base seed — PRODUCTION-SAFE reference data only. Idempotent.
 *
 * Intentionally creates NO users, teams, tournaments, matches or statistics: real data only
 * comes from verified Steam logins and real workflows. Demo data lives in `seed-sample.ts`.
 *
 * Bootstrap administrator (planned for M1, NOT implemented here):
 *   The operator sets env `BOOTSTRAP_SUPER_ADMIN_STEAM_ID64=<17-digit id>`. When a user with
 *   exactly that SteamID64 completes a *verified* Steam OpenID login, the auth service grants
 *   SUPER_ADMIN (user_role_grants, scope GLOBAL, issued_by NULL) inside the login transaction
 *   and writes an audit_logs row ("role_grant.bootstrap"). The grant is idempotent thanks to
 *   the partial unique index `user_role_grants_active_uniq`. Sample SteamIDs are never eligible.
 *   Seeds never create admins, because an admin row without a verified login is a backdoor.
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient, type PrismaClient } from '../src/index.js';
import { loadRootEnv, ownerDatabaseUrl } from './load-env.js';

export interface BaseSeedSummary {
  referenceRowsUpserted: number;
}

export async function runBaseSeed(prisma: PrismaClient): Promise<BaseSeedSummary> {
  // Sanity check: migrations must have been applied before seeding.
  await prisma.$queryRaw`SELECT 1 FROM "users" LIMIT 1`;
  // No reference tables exist yet in M0 (roles/statuses/command types are Postgres enums).
  // Future reference data (e.g. an official CS2 map pool) must be upserted here by natural key.
  return { referenceRowsUpserted: 0 };
}

async function main(): Promise<void> {
  loadRootEnv();
  const prisma = createPrismaClient({ databaseUrl: ownerDatabaseUrl() });
  try {
    const summary = await runBaseSeed(prisma);
    console.warn(`[seed] base seed complete: ${JSON.stringify(summary)}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  });
}

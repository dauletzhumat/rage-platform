import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppModule, type AppModuleOptions } from '../../src/app.module.js';
import { configureApp, setupSwagger } from '../../src/app.setup.js';
import { type Env, loadDotEnvForDevelopment, parseEnv } from '../../src/config/env.js';
import { PrismaService } from '../../src/infra/prisma/prisma.service.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export function testEnv(overrides: Record<string, string> = {}): Env {
  loadDotEnvForDevelopment(repoRoot);
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
  return parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    API_CORS_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_PER_MINUTE: '10000',
    ...overrides,
  });
}

export async function createTestApp(
  overrides: Record<string, string> = {},
  moduleOptions: AppModuleOptions = {},
): Promise<NestExpressApplication> {
  const env = testEnv(overrides);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env, moduleOptions)],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, env);
  if (env.API_DOCS_ENABLED) setupSwagger(app);
  await app.init();
  return app;
}

export function prismaOf(app: NestExpressApplication) {
  return app.get(PrismaService).client;
}

/**
 * Remove all rows touched by these tests (FK-safe). CASCADE reaches append-only tables
 * (match_events, audit_logs), so this uses the documented test/maintenance escape hatch,
 * scoped to one transaction (`SET LOCAL`).
 */
export async function truncateAll(app: NestExpressApplication): Promise<void> {
  const db = prismaOf(app);
  await db.$transaction([
    db.$executeRawUnsafe(`SET LOCAL rage.allow_append_only_maintenance = 'on'`),
    db.$executeRawUnsafe(
      `TRUNCATE TABLE match_maps, matches, tournament_registrations, tournaments,
         team_memberships, teams, player_profiles, steam_profiles, users RESTART IDENTITY CASCADE`,
    ),
  ]);
}

let steamSeq = 100;
/** SteamID64s from the reserved sample range (never real accounts; see ADR-011). */
export function sampleSteamId(): string {
  steamSeq += 1;
  return `76561190000000${String(steamSeq).padStart(3, '0')}`;
}

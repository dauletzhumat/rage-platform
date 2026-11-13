import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resetAndMigrateTestDatabase, runPrismaCli, withPgClient } from './helpers/test-db.js';

const EXPECTED_TABLES = [
  'users',
  'auth_sessions',
  'steam_profiles',
  'player_profiles',
  'user_role_grants',
  'team_applications',
  'teams',
  'team_memberships',
  'team_invitations',
  'team_staff',
  'team_achievements',
  'team_ranking_snapshots',
  'tournaments',
  'tournament_stages',
  'tournament_registrations',
  'tournament_rosters',
  'tournament_roster_entries',
  'brackets',
  'bracket_slots',
  'matches',
  'match_rosters',
  'match_maps',
  'match_map_players',
  'map_veto_actions',
  'match_rounds',
  'game_servers',
  'server_agents',
  'server_allocations',
  'server_command_requests',
  'match_events',
  'player_map_stats',
  'player_round_stats',
  'team_map_stats',
  'demos',
  'audit_logs',
  'outbox_events',
  'idempotency_keys',
];

// Runs last alphabetically-independent: it resets the schema itself, so it is safe in any order.
describe('migrations on a fresh database', () => {
  it('apply cleanly from an empty schema', async () => {
    await resetAndMigrateTestDatabase();

    const migrationDirs = readdirSync(
      path.resolve(import.meta.dirname, '..', 'prisma', 'migrations'),
      {
        withFileTypes: true,
      },
    ).filter((d) => d.isDirectory());

    await withPgClient(async (c) => {
      const applied = await c.query<{
        migration_name: string;
        finished_at: Date | null;
        rolled_back_at: Date | null;
      }>(
        'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name',
      );
      expect(applied.rows.map((r) => r.migration_name)).toEqual(
        migrationDirs.map((d) => d.name).sort(),
      );
      expect(applied.rows.every((r) => r.finished_at !== null && r.rolled_back_at === null)).toBe(
        true,
      );

      const tables = await c.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
      );
      const names = new Set(tables.rows.map((r) => r.table_name));
      expect(EXPECTED_TABLES.filter((t) => !names.has(t))).toEqual([]);

      const triggers = await c.query<{ tgname: string }>(
        "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%append_only%' ORDER BY tgname",
      );
      expect(triggers.rows.map((r) => r.tgname)).toEqual([
        'audit_logs_append_only',
        'audit_logs_append_only_truncate',
        'match_events_append_only',
        'match_events_append_only_truncate',
      ]);
    });
  });

  it('leave no drift between schema.prisma and the database (raw SQL indexes are not dropped)', () => {
    const out = runPrismaCli([
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--script',
    ]);
    expect(out).toContain('This is an empty migration.');
  });

  it('report an up-to-date migration status', () => {
    const out = runPrismaCli(['migrate', 'status']);
    expect(out).toMatch(/Database schema is up to date/);
  });
});

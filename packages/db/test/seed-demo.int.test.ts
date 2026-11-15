import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { isSampleSteamId64, type PrismaClient } from '../src/index.js';
import { assertDemoSeedAllowed, DEMO_MAP_POOL, runDemoSeed } from '../prisma/seed-demo.js';
import { createTestPrisma, resetAndMigrateTestDatabase } from './helpers/test-db.js';

let prisma: PrismaClient;
const savedEnv = { NODE_ENV: process.env.NODE_ENV, ALLOW_DEMO_SEED: process.env.ALLOW_DEMO_SEED };

beforeAll(async () => {
  await resetAndMigrateTestDatabase();
  prisma = createTestPrisma();
}, 120_000);
afterEach(() => {
  process.env.NODE_ENV = savedEnv.NODE_ENV;
  process.env.ALLOW_DEMO_SEED = savedEnv.ALLOW_DEMO_SEED;
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function nonSampleSnapshot() {
  return {
    users: await prisma.user.findMany({ where: { isSample: false }, orderBy: { id: 'asc' } }),
    profiles: await prisma.playerProfile.findMany({
      where: { user: { isSample: false } },
      orderBy: { id: 'asc' },
    }),
    teams: await prisma.team.findMany({ where: { isSample: false }, orderBy: { id: 'asc' } }),
    memberships: await prisma.teamMembership.findMany({
      where: { team: { isSample: false } },
      orderBy: { id: 'asc' },
    }),
    tournaments: await prisma.tournament.findMany({
      where: { isSample: false },
      orderBy: { id: 'asc' },
    }),
  };
}

describe('demo seed (db:seed:demo)', () => {
  it('refuses in production and without ALLOW_DEMO_SEED=true', async () => {
    expect(() => assertDemoSeedAllowed({ NODE_ENV: 'development' })).toThrow(/ALLOW_DEMO_SEED/);
    expect(() =>
      assertDemoSeedAllowed({ NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true' }),
    ).toThrow(/production/);
    expect(() => assertDemoSeedAllowed({ NODE_ENV: 'test', ALLOW_DEMO_SEED: '1' })).toThrow();
    expect(() =>
      assertDemoSeedAllowed({ NODE_ENV: 'development', ALLOW_DEMO_SEED: 'true' }),
    ).not.toThrow();
    process.env.ALLOW_DEMO_SEED = 'false';
    await expect(runDemoSeed(prisma)).rejects.toThrow(/ALLOW_DEMO_SEED/);
    expect(await prisma.tournament.count({ where: { name: { startsWith: 'Demo Cup' } } })).toBe(0);
  });

  it('runs twice next to real data: users/teams idempotent, one new sample tournament per run', async () => {
    // Real (non-sample) rows must survive untouched.
    const real = await prisma.user.create({
      data: {
        steamId64: '76561198000123456',
        playerProfile: { create: { nickname: 'real-player', slug: 'real-player-demo-test' } },
      },
    });
    const realTeam = await prisma.team.create({
      data: { slug: 'real-team-demo-test', name: 'Real Team Demo Test', tag: 'RTDT' },
    });
    await prisma.teamMembership.create({
      data: { teamId: realTeam.id, userId: real.id, role: 'CAPTAIN' },
    });
    const before = await nonSampleSnapshot();

    process.env.ALLOW_DEMO_SEED = 'true';
    const first = await runDemoSeed(prisma);
    const second = await runDemoSeed(prisma);

    expect(first).toMatchObject({
      users: 40,
      teams: 8,
      registrations: 8,
      tournament: { name: 'Demo Cup #1', slug: 'demo-cup-1' },
    });
    expect(second.tournament).toMatchObject({ name: 'Demo Cup #2', slug: 'demo-cup-2' });
    expect(await nonSampleSnapshot()).toEqual(before);

    // 40 users in the reserved range 101..140, all sample, each with a profile.
    const users = await prisma.user.findMany({
      where: { steamId64: { gte: '76561190000000101', lte: '76561190000000140' } },
      include: { playerProfile: true },
    });
    expect(users).toHaveLength(40);
    for (const u of users) {
      expect(u.isSample).toBe(true);
      expect(isSampleSteamId64(u.steamId64)).toBe(true);
      expect(u.playerProfile?.nickname).toMatch(/^demo\.[a-z]+[1-5]$/);
    }

    // 8 sample teams, tags DM1..DM8, captain + 4 players each (active).
    const teams = await prisma.team.findMany({
      where: { slug: { startsWith: 'demo-' } },
      include: { memberships: { where: { leftAt: null } } },
      orderBy: { tag: 'asc' },
    });
    expect(teams).toHaveLength(8);
    expect(teams.map((t) => t.tag)).toEqual([
      'DM1',
      'DM2',
      'DM3',
      'DM4',
      'DM5',
      'DM6',
      'DM7',
      'DM8',
    ]);
    for (const t of teams) {
      expect(t.isSample).toBe(true);
      expect(t.memberships).toHaveLength(5);
      expect(t.memberships.filter((m) => m.role === 'CAPTAIN')).toHaveLength(1);
    }

    // Each run: a new sample tournament with 8 PENDING registrations, roster v1 DRAFT, 5 starters.
    const cups = await prisma.tournament.findMany({
      where: { name: { startsWith: 'Demo Cup #' } },
      include: {
        registrations: { include: { rosters: { include: { entries: true } } } },
      },
      orderBy: { name: 'asc' },
    });
    expect(cups).toHaveLength(2);
    for (const cup of cups) {
      expect(cup).toMatchObject({
        isSample: true,
        status: 'REGISTRATION_OPEN',
        format: 'SINGLE_ELIMINATION',
        defaultMatchFormat: 'BO1',
        maxTeams: 8,
      });
      expect(cup.settingsJson).toMatchObject({
        mapPool: [...DEMO_MAP_POOL],
        finalMatchFormat: 'BO3',
      });
      expect(cup.registrations).toHaveLength(8);
      for (const reg of cup.registrations) {
        expect(reg.status).toBe('PENDING');
        expect(reg.rosters).toHaveLength(1);
        const roster = reg.rosters[0]!;
        expect(roster).toMatchObject({ version: 1, status: 'DRAFT', lockedAt: null });
        expect(roster.entries).toHaveLength(5);
        for (const e of roster.entries) {
          expect(e.role).toBe('STARTER');
          expect(isSampleSteamId64(e.steamId64Snapshot)).toBe(true);
        }
      }
    }
    // Nothing else was created for sample data (no matches, stats or results).
    expect(
      await prisma.match.count({ where: { tournament: { name: { startsWith: 'Demo Cup' } } } }),
    ).toBe(0);
  });

  it('aborts without writing when a demo slug belongs to a non-sample row', async () => {
    process.env.ALLOW_DEMO_SEED = 'true';
    await prisma.$transaction(async (tx) => {
      // Simulate a real team squatting a demo slug (rename the sample one out of the way first).
      await tx.team.update({ where: { slug: 'demo-hotel' }, data: { slug: 'demo-hotel-old' } });
    });
    await prisma.team.create({
      data: { slug: 'demo-hotel', name: 'Real Hotel', tag: 'RHTL' },
    });
    const cupsBefore = await prisma.tournament.count({
      where: { name: { startsWith: 'Demo Cup' } },
    });
    await expect(runDemoSeed(prisma)).rejects.toThrow(/NOT sample data/);
    expect(await prisma.tournament.count({ where: { name: { startsWith: 'Demo Cup' } } })).toBe(
      cupsBefore,
    );
  });
});

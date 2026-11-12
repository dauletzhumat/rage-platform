import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isSampleSteamId64, type PrismaClient } from '../src/index.js';
import { runBaseSeed } from '../prisma/seed.js';
import { runSampleSeed } from '../prisma/seed-sample.js';
import { createTestPrisma, resetAndMigrateTestDatabase } from './helpers/test-db.js';

let prisma: PrismaClient;

// Fresh schema: other suites leave real-range users behind, and seed:sample (by design)
// refuses to run against a database that holds any real user.
beforeAll(async () => {
  await resetAndMigrateTestDatabase();
  prisma = createTestPrisma();
}, 120_000);
afterAll(async () => {
  await prisma.$disconnect();
});

async function sampleCounts() {
  return {
    users: await prisma.user.count({ where: { isSample: true } }),
    profiles: await prisma.playerProfile.count({ where: { user: { isSample: true } } }),
    teams: await prisma.team.count({ where: { isSample: true } }),
    memberships: await prisma.teamMembership.count({ where: { team: { isSample: true } } }),
    applications: await prisma.teamApplication.count({ where: { applicant: { isSample: true } } }),
    tournaments: await prisma.tournament.count({ where: { isSample: true } }),
    registrations: await prisma.tournamentRegistration.count({
      where: { tournament: { isSample: true } },
    }),
    rosterEntries: await prisma.tournamentRosterEntry.count({
      where: { user: { isSample: true } },
    }),
    matches: await prisma.match.count({ where: { isSample: true } }),
  };
}

describe('base seed', () => {
  it('is idempotent and creates no fake data', async () => {
    const before = await prisma.user.count();
    expect(await runBaseSeed(prisma)).toEqual({ referenceRowsUpserted: 0 });
    expect(await runBaseSeed(prisma)).toEqual({ referenceRowsUpserted: 0 });
    expect(await prisma.user.count()).toBe(before);
  });
});

describe('sample seed', () => {
  it('runs twice idempotently and labels everything as sample', async () => {
    const first = await runSampleSeed(prisma);
    const countsAfterFirst = await sampleCounts();
    const second = await runSampleSeed(prisma);
    const countsAfterSecond = await sampleCounts();

    expect(second).toEqual(first);
    expect(countsAfterSecond).toEqual(countsAfterFirst);
    expect(countsAfterFirst).toMatchObject({
      users: 12,
      profiles: 12,
      teams: 2,
      memberships: 10,
      applications: 3, // 2 approved + 1 pending
      tournaments: 1,
      registrations: 2,
      rosterEntries: 10,
      matches: 1,
    });

    // Every sample-range user is flagged, and every flagged user uses a sample SteamID.
    const users = await prisma.user.findMany({
      where: { steamId64: { startsWith: '765611900000' } },
    });
    expect(users).toHaveLength(12);
    for (const u of users) {
      expect(u.isSample).toBe(true);
      expect(isSampleSteamId64(u.steamId64)).toBe(true);
    }
    const flagged = await prisma.user.findMany({ where: { isSample: true } });
    expect(flagged.every((u) => isSampleSteamId64(u.steamId64))).toBe(true);

    // Teams exist only via APPROVED applications; one application is still pending (no team).
    const teams = await prisma.team.findMany({
      where: { isSample: true },
      include: { application: true, memberships: true },
    });
    for (const t of teams) {
      expect(t.application?.status).toBe('APPROVED');
      expect(t.memberships.filter((m) => m.role === 'CAPTAIN' && m.leftAt === null)).toHaveLength(
        1,
      );
    }
    expect(
      await prisma.teamApplication.count({
        where: { status: 'PENDING', applicant: { isSample: true } },
      }),
    ).toBe(1);

    const tournament = await prisma.tournament.findUniqueOrThrow({ where: { slug: 'sample-cup' } });
    expect(tournament).toMatchObject({
      status: 'REGISTRATION_OPEN',
      format: 'SINGLE_ELIMINATION',
      defaultMatchFormat: 'BO1',
    });

    // The scheduled match has no result and NO statistics of any kind.
    const match = await prisma.match.findFirstOrThrow({ where: { isSample: true } });
    expect(match).toMatchObject({
      status: 'CREATED',
      teamAScore: null,
      teamBScore: null,
      winnerTeamId: null,
      resultVerifiedAt: null,
    });
    expect(await prisma.matchMap.count({ where: { matchId: match.id } })).toBe(0);
    expect(await prisma.matchEvent.count({ where: { matchId: match.id } })).toBe(0);
    expect(await prisma.playerMapStat.count({ where: { user: { isSample: true } } })).toBe(0);
    expect(await prisma.playerRoundStat.count({ where: { user: { isSample: true } } })).toBe(0);
    expect(await prisma.teamMapStat.count({ where: { team: { isSample: true } } })).toBe(0);
    expect(await prisma.steamProfile.count({ where: { user: { isSample: true } } })).toBe(0);
  });

  it('refuses to run when the database holds any real (non-sample) user', async () => {
    const real = await prisma.user.create({
      data: { steamId64: '76561198000000001', isSample: false },
    });
    try {
      await expect(runSampleSeed(prisma)).rejects.toThrow(/real \(non-sample\) user/);
    } finally {
      await prisma.user.delete({ where: { id: real.id } });
    }
  });

  it('refuses to run with NODE_ENV=production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(runSampleSeed(prisma)).rejects.toThrow(/production/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

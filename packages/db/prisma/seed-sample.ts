/**
 * SAMPLE (demo) seed — DEVELOPMENT ONLY. Idempotent (safe to run repeatedly).
 *
 * - Refuses to run when NODE_ENV=production.
 * - Every user/team/tournament/match it creates has is_sample = true.
 * - Sample users use SteamID64 values 76561190000000001..76561190000000999, which are below the
 *   individual-account base and can never belong to a real Steam account (see src/steam-id.ts).
 * - Creates NO statistics, events, rounds, scores or Steam profile data: never fabricate stats.
 */
import { pathToFileURL } from 'node:url';
import {
  createPrismaClient,
  sampleSteamId64,
  type Prisma,
  type PrismaClient,
} from '../src/index.js';
import { loadRootEnv, ownerDatabaseUrl } from './load-env.js';

type Tx = Prisma.TransactionClient;

const SAMPLE_PLAYERS = [
  'kestrel',
  'marlin',
  'quill',
  'tundra',
  'ember',
  'vortex',
  'lumen',
  'basalt',
  'sable',
  'cinder',
  'juniper',
  'orchid',
] as const;

const SAMPLE_TEAMS = [
  {
    name: 'Sample Falcons',
    tag: 'SFAL',
    slug: 'sample-falcons',
    captain: 0,
    players: [0, 1, 2, 3, 4],
  },
  {
    name: 'Sample Wolves',
    tag: 'SWLF',
    slug: 'sample-wolves',
    captain: 5,
    players: [5, 6, 7, 8, 9],
  },
] as const;

/** Player index (0-based) who has a PENDING application for a third team. */
const PENDING_APPLICANT = 10;
/** Player index used as the (sample) reviewer of the approved applications. */
const SAMPLE_REVIEWER = 11;

const TOURNAMENT_SLUG = 'sample-cup';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SampleSeedSummary {
  users: number;
  teams: number;
  memberships: number;
  pendingApplications: number;
  tournaments: number;
  matches: number;
}

export function assertSampleSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'seed:sample refuses to run with NODE_ENV=production (demo data is development-only)',
    );
  }
}

function ensureSample(kind: string, key: string, row: { isSample: boolean } | null): void {
  if (row && !row.isSample) {
    throw new Error(
      `seed:sample: existing ${kind} "${key}" is NOT sample data; refusing to touch it`,
    );
  }
}

async function upsertSampleUsers(
  tx: Tx,
): Promise<{ id: string; steamId64: string; nickname: string }[]> {
  const users: { id: string; steamId64: string; nickname: string }[] = [];
  for (const [index, handle] of SAMPLE_PLAYERS.entries()) {
    const steamId64 = sampleSteamId64(index + 1);
    const nickname = `sample.${handle}`;
    ensureSample('user', steamId64, await tx.user.findUnique({ where: { steamId64 } }));
    const user = await tx.user.upsert({
      where: { steamId64 },
      create: { steamId64, isSample: true },
      update: {},
    });
    await tx.playerProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, nickname, slug: `sample-${handle}` },
      update: {},
    });
    users.push({ id: user.id, steamId64, nickname });
  }
  return users;
}

/**
 * Second guard independent of NODE_ENV (security LOW-4): a database that already holds
 * any real (non-sample) user is treated as a real environment and never receives demo data.
 */
export async function assertDatabaseHasNoRealUsers(prisma: PrismaClient): Promise<void> {
  const realUsers = await prisma.user.count({ where: { isSample: false } });
  if (realUsers > 0) {
    throw new Error(
      `seed:sample refuses to run: database contains ${realUsers} real (non-sample) user(s)`,
    );
  }
}

export async function runSampleSeed(prisma: PrismaClient): Promise<SampleSeedSummary> {
  assertSampleSeedAllowed();
  await assertDatabaseHasNoRealUsers(prisma);

  return prisma.$transaction(
    async (tx) => {
      const users = await upsertSampleUsers(tx);
      const userAt = (i: number) => {
        const u = users[i];
        if (!u) throw new Error(`sample user index ${i} missing`);
        return u;
      };
      const reviewer = userAt(SAMPLE_REVIEWER);
      const now = new Date();

      // --- Teams: created only through an APPROVED application (mirrors the real workflow) ---
      const teams: { id: string; slug: string }[] = [];
      let membershipCount = 0;
      for (const spec of SAMPLE_TEAMS) {
        const captain = userAt(spec.captain);
        const existing = await tx.team.findUnique({ where: { slug: spec.slug } });
        ensureSample('team', spec.slug, existing);
        const team =
          existing ??
          (await tx.team.create({
            data: {
              name: spec.name,
              tag: spec.tag,
              slug: spec.slug,
              isSample: true,
              description: 'Demo team (sample data).',
            },
          }));
        teams.push({ id: team.id, slug: team.slug });

        const application = await tx.teamApplication.findUnique({
          where: { createdTeamId: team.id },
        });
        if (!application) {
          await tx.teamApplication.create({
            data: {
              applicantUserId: captain.id,
              requestedName: spec.name,
              requestedTag: spec.tag,
              requestedSlug: spec.slug,
              description: 'Demo team (sample data).',
              status: 'APPROVED',
              reviewedById: reviewer.id,
              reviewedAt: now,
              reviewReason: 'Sample data',
              createdTeamId: team.id,
            },
          });
        }

        for (const playerIndex of spec.players) {
          const player = userAt(playerIndex);
          const active = await tx.teamMembership.findFirst({
            where: { userId: player.id, leftAt: null },
          });
          if (active) {
            if (active.teamId !== team.id) {
              throw new Error(
                `seed:sample: ${player.nickname} already has an active membership in another team`,
              );
            }
          } else {
            await tx.teamMembership.create({
              data: {
                teamId: team.id,
                userId: player.id,
                role: playerIndex === spec.captain ? 'CAPTAIN' : 'PLAYER',
                invitedById: playerIndex === spec.captain ? null : captain.id,
              },
            });
          }
          membershipCount += 1;
        }
      }

      // --- One PENDING application (no team exists for it) ---
      const applicant = userAt(PENDING_APPLICANT);
      const pending = await tx.teamApplication.findFirst({
        where: { applicantUserId: applicant.id, status: 'PENDING' },
      });
      if (!pending) {
        await tx.teamApplication.create({
          data: {
            applicantUserId: applicant.id,
            requestedName: 'Sample Herons',
            requestedTag: 'SHER',
            requestedSlug: 'sample-herons',
            description: 'Pending demo application (sample data).',
          },
        });
      }

      // --- Tournament (REGISTRATION_OPEN, single-elimination BO1) ---
      const existingTournament = await tx.tournament.findUnique({
        where: { slug: TOURNAMENT_SLUG },
      });
      ensureSample('tournament', TOURNAMENT_SLUG, existingTournament);
      const tournament =
        existingTournament ??
        (await tx.tournament.create({
          data: {
            slug: TOURNAMENT_SLUG,
            name: 'RAGE Sample Cup (demo data)',
            format: 'SINGLE_ELIMINATION',
            status: 'REGISTRATION_OPEN',
            defaultMatchFormat: 'BO1',
            maxTeams: 8,
            registrationOpenAt: now,
            registrationCloseAt: new Date(now.getTime() + 14 * DAY_MS),
            startsAt: new Date(now.getTime() + 21 * DAY_MS),
            settingsJson: { sample: true, rosterStarters: 5, maxSubstitutes: 2 },
            isSample: true,
          },
        }));
      const stage = await tx.tournamentStage.upsert({
        where: { tournamentId_sequence: { tournamentId: tournament.id, sequence: 1 } },
        create: {
          tournamentId: tournament.id,
          sequence: 1,
          name: 'Playoffs',
          format: 'SINGLE_ELIMINATION',
        },
        update: {},
      });

      // --- Registrations with locked roster snapshots (version 1) ---
      for (const [teamIndex, spec] of SAMPLE_TEAMS.entries()) {
        const team = teams[teamIndex];
        if (!team) throw new Error('team missing');
        const captain = userAt(spec.captain);
        const registration = await tx.tournamentRegistration.upsert({
          where: { tournamentId_teamId: { tournamentId: tournament.id, teamId: team.id } },
          create: {
            tournamentId: tournament.id,
            teamId: team.id,
            requestedById: captain.id,
            status: 'APPROVED',
            seed: teamIndex + 1,
            reviewedById: reviewer.id,
            reviewedAt: now,
          },
          update: {},
        });
        const roster = await tx.tournamentRoster.upsert({
          where: { registrationId_version: { registrationId: registration.id, version: 1 } },
          create: {
            registrationId: registration.id,
            version: 1,
            status: 'LOCKED',
            lockedAt: now,
            lockedById: reviewer.id,
          },
          update: {},
        });
        for (const playerIndex of spec.players) {
          const player = userAt(playerIndex);
          await tx.tournamentRosterEntry.upsert({
            where: { rosterId_userId: { rosterId: roster.id, userId: player.id } },
            create: {
              rosterId: roster.id,
              userId: player.id,
              steamId64Snapshot: player.steamId64,
              nicknameSnapshot: player.nickname,
              role: 'STARTER',
            },
            update: {},
          });
        }
      }

      // --- One scheduled match: CREATED, no scores, no maps/stats/events ---
      const [teamA, teamB] = teams;
      if (!teamA || !teamB) throw new Error('teams missing');
      const existingMatch = await tx.match.findFirst({
        where: { tournamentId: tournament.id, teamAId: teamA.id, teamBId: teamB.id },
      });
      ensureSample('match', `${teamA.slug} vs ${teamB.slug}`, existingMatch);
      if (!existingMatch) {
        await tx.match.create({
          data: {
            tournamentId: tournament.id,
            stageId: stage.id,
            teamAId: teamA.id,
            teamBId: teamB.id,
            format: 'BO1',
            status: 'CREATED',
            scheduledAt: tournament.startsAt,
            isSample: true,
          },
        });
      }

      return {
        users: users.length,
        teams: teams.length,
        memberships: membershipCount,
        pendingApplications: 1,
        tournaments: 1,
        matches: 1,
      };
    },
    { timeout: 30_000 },
  );
}

async function main(): Promise<void> {
  loadRootEnv();
  assertSampleSeedAllowed();
  const prisma = createPrismaClient({ databaseUrl: ownerDatabaseUrl() });
  try {
    const summary = await runSampleSeed(prisma);
    console.warn(`[seed:sample] DEMO data ensured (is_sample=true): ${JSON.stringify(summary)}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error('[seed:sample] failed:', error);
    process.exitCode = 1;
  });
}

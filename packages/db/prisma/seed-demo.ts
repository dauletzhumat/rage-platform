/**
 * DEMO seed for the M3 tournament flow — DEVELOPMENT ONLY.
 *
 * Lets an owner click through registration review → bracket → veto → results on SAMPLE data
 * (with the API's dev-only `ALLOW_SAMPLE_MUTATIONS=true`), without real Steam accounts.
 *
 * Guards:
 * - refuses unless NODE_ENV !== 'production' AND ALLOW_DEMO_SEED=true;
 * - unlike seed:sample it MAY run when real users exist, because it only ever touches rows in the
 *   reserved sample SteamID range (76561190000000101–140) and rows flagged `is_sample`; any
 *   clash with a non-sample row aborts the whole transaction (nothing is written).
 *
 * Creates/ensures (idempotent): 40 sample users with player profiles, 8 sample teams
 * (`demo-<word>`, tags DM1–DM8) with a captain + 4 players each. On EVERY run it also creates a
 * NEW sample tournament "Demo Cup #N" (REGISTRATION_OPEN, SINGLE_ELIMINATION, BO1, final BO3,
 * maxTeams 8, a clearly fake 7-map pool) with 8 PENDING registrations, each with roster v1
 * DRAFT (5 starters, SteamID64 + nickname snapshot). No statistics, matches or results.
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

export const DEMO_TEAM_WORDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
] as const;
export const DEMO_PLAYERS_PER_TEAM = 5;
/** First sample SteamID index used by the demo seed (76561190000000101). */
export const DEMO_FIRST_SAMPLE_INDEX = 101;
export const DEMO_MAP_POOL = [
  'de_sample_alpha',
  'de_sample_bravo',
  'de_sample_charlie',
  'de_sample_delta',
  'de_sample_echo',
  'de_sample_foxtrot',
  'de_sample_golf',
] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_PREFIX = 'Demo Cup #';

export interface DemoSeedSummary {
  users: number;
  teams: number;
  tournament: { id: string; slug: string; name: string };
  registrations: number;
}

export function assertDemoSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  // Normalised and allowlisted (demo-mode review L-2): unset, development or test only.
  const nodeEnv = (env.NODE_ENV ?? '').trim().toLowerCase();
  if (nodeEnv !== '' && nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error(
      `db:seed:demo refuses to run with NODE_ENV=${env.NODE_ENV} (development or test only)`,
    );
  }
  if (env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('db:seed:demo refuses to run unless ALLOW_DEMO_SEED=true');
  }
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function refuseNonSample(kind: string, key: string, row: { isSample: boolean } | null): void {
  if (row && !row.isSample) {
    throw new Error(`db:seed:demo: existing ${kind} "${key}" is NOT sample data; refusing`);
  }
}

interface DemoPlayer {
  id: string;
  steamId64: string;
  nickname: string;
}

async function ensurePlayer(tx: Tx, index: number, word: string, n: number): Promise<DemoPlayer> {
  const steamId64 = sampleSteamId64(index);
  const nickname = `demo.${word}${n}`;
  const slug = `demo-${word}-${n}`;
  refuseNonSample('user', steamId64, await tx.user.findUnique({ where: { steamId64 } }));
  const user = await tx.user.upsert({
    where: { steamId64 },
    create: { steamId64, isSample: true },
    update: {},
  });
  const bySlug = await tx.playerProfile.findUnique({ where: { slug } });
  if (bySlug && bySlug.userId !== user.id) {
    throw new Error(`db:seed:demo: player slug "${slug}" belongs to another user; refusing`);
  }
  const profile = await tx.playerProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, nickname, slug },
    update: {},
  });
  return { id: user.id, steamId64, nickname: profile.nickname };
}

async function ensureTeam(
  tx: Tx,
  word: string,
  tagNumber: number,
  players: DemoPlayer[],
): Promise<{ id: string; captain: DemoPlayer; players: DemoPlayer[] }> {
  const slug = `demo-${word}`;
  const existing = await tx.team.findUnique({ where: { slug } });
  refuseNonSample('team', slug, existing);
  const team =
    existing ??
    (await tx.team.create({
      data: {
        slug,
        name: `Demo ${capitalize(word)}`,
        tag: `DM${tagNumber}`,
        status: 'ACTIVE',
        isSample: true,
        description: 'Demo team (sample data, M3 click-through).',
      },
    }));
  const captain = players[0]!;
  for (const [i, player] of players.entries()) {
    const active = await tx.teamMembership.findFirst({
      where: { userId: player.id, leftAt: null },
    });
    if (active) {
      if (active.teamId !== team.id) {
        throw new Error(`db:seed:demo: ${player.nickname} is active in another team; refusing`);
      }
      continue;
    }
    await tx.teamMembership.create({
      data: {
        teamId: team.id,
        userId: player.id,
        role: i === 0 ? 'CAPTAIN' : 'PLAYER',
        invitedById: i === 0 ? null : captain.id,
      },
    });
  }
  return { id: team.id, captain, players };
}

/** Next free "Demo Cup #N": N = 1 + highest N used by any tournament with that name pattern. */
async function nextDemoCup(tx: Tx): Promise<{ name: string; slug: string }> {
  const rows = await tx.tournament.findMany({
    where: { name: { startsWith: NAME_PREFIX } },
    select: { name: true },
  });
  let n = 0;
  for (const r of rows) {
    const m = /^Demo Cup #(\d+)$/.exec(r.name);
    if (m) n = Math.max(n, Number(m[1]));
  }
  for (let candidate = n + 1; ; candidate++) {
    const name = `${NAME_PREFIX}${candidate}`;
    const slug = `demo-cup-${candidate}`;
    const clash = await tx.tournament.findFirst({
      where: { OR: [{ slug }, { name: { equals: name, mode: 'insensitive' } }] },
      select: { id: true },
    });
    if (!clash) return { name, slug };
  }
}

export async function runDemoSeed(prisma: PrismaClient): Promise<DemoSeedSummary> {
  assertDemoSeedAllowed();
  return prisma.$transaction(
    async (tx) => {
      const teams: Awaited<ReturnType<typeof ensureTeam>>[] = [];
      for (const [t, word] of DEMO_TEAM_WORDS.entries()) {
        const players: DemoPlayer[] = [];
        for (let p = 0; p < DEMO_PLAYERS_PER_TEAM; p++) {
          const index = DEMO_FIRST_SAMPLE_INDEX + t * DEMO_PLAYERS_PER_TEAM + p;
          players.push(await ensurePlayer(tx, index, word, p + 1));
        }
        teams.push(await ensureTeam(tx, word, t + 1, players));
      }

      const now = new Date();
      const cup = await nextDemoCup(tx);
      const tournament = await tx.tournament.create({
        data: {
          slug: cup.slug,
          name: cup.name,
          format: 'SINGLE_ELIMINATION',
          status: 'REGISTRATION_OPEN',
          defaultMatchFormat: 'BO1',
          maxTeams: 8,
          registrationOpenAt: now,
          startsAt: new Date(now.getTime() + 7 * DAY_MS),
          settingsJson: {
            sample: true,
            description: 'Demo tournament (sample data) for clicking through the M3 flow.',
            mapPool: [...DEMO_MAP_POOL],
            finalMatchFormat: 'BO3',
          },
          isSample: true,
        },
      });

      for (const team of teams) {
        const registration = await tx.tournamentRegistration.create({
          data: {
            tournamentId: tournament.id,
            teamId: team.id,
            requestedById: team.captain.id,
            status: 'PENDING',
          },
        });
        const roster = await tx.tournamentRoster.create({
          data: { registrationId: registration.id, version: 1, status: 'DRAFT' },
        });
        await tx.tournamentRosterEntry.createMany({
          data: team.players.map((p) => ({
            rosterId: roster.id,
            userId: p.id,
            steamId64Snapshot: p.steamId64,
            nicknameSnapshot: p.nickname,
            role: 'STARTER' as const,
          })),
        });
      }

      return {
        users: teams.length * DEMO_PLAYERS_PER_TEAM,
        teams: teams.length,
        tournament: { id: tournament.id, slug: tournament.slug, name: tournament.name },
        registrations: teams.length,
      };
    },
    { timeout: 60_000 },
  );
}

async function main(): Promise<void> {
  loadRootEnv();
  assertDemoSeedAllowed();
  const prisma = createPrismaClient({ databaseUrl: ownerDatabaseUrl() });
  try {
    const summary = await runDemoSeed(prisma);
    console.warn(
      `[db:seed:demo] sample data ensured (is_sample=true): ${summary.users} users, ` +
        `${summary.teams} teams; created "${summary.tournament.name}" with ` +
        `${summary.registrations} PENDING registrations.`,
    );
    console.warn(`[db:seed:demo] tournament slug: ${summary.tournament.slug}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error('[db:seed:demo] failed:', error);
    process.exitCode = 1;
  });
}

// M3 constraints (docs/TOURNAMENTS.md, ADR-020, ADR-018 Q5; migration 20261114000000_m3_tournaments).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_CONSTRAINTS, MatchStatus, type PrismaClient } from '../src/index.js';
import { getDbViolation } from '../src/errors.js';
import {
  createTestPrisma,
  expectDbError,
  uniqueSteamId64,
  uniqueSuffix,
  uniqueTag,
  withPgClient,
} from './helpers/test-db.js';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const re = (name: string) => new RegExp(name);
const newUser = () => prisma.user.create({ data: { steamId64: uniqueSteamId64() } });

async function newTeam() {
  const s = uniqueSuffix();
  return prisma.team.create({
    data: { name: `Team ${s}`, tag: uniqueTag('M'), slug: `team-${s}` },
  });
}

async function newTournament(data: { maxTeams?: number; name?: string } = {}) {
  const s = uniqueSuffix();
  return prisma.tournament.create({
    data: {
      slug: `cup-${s}`,
      name: data.name ?? `Cup ${s}`,
      format: 'SINGLE_ELIMINATION',
      maxTeams: data.maxTeams,
    },
  });
}

async function newRegistration(tournamentId?: string) {
  const [team, captain] = [await newTeam(), await newUser()];
  const tId = tournamentId ?? (await newTournament()).id;
  return prisma.tournamentRegistration.create({
    data: { tournamentId: tId, teamId: team.id, requestedById: captain.id },
  });
}

async function newMatch() {
  const [a, b] = [await newTeam(), await newTeam()];
  return prisma.match.create({ data: { teamAId: a.id, teamBId: b.id, format: 'BO3' } });
}

/** Postgres error (pg driver) for raw-SQL assertions. */
async function pgError(sql: string, params: unknown[] = []): Promise<string> {
  return withPgClient(async (c) => {
    try {
      await c.query(sql, params);
    } catch (error) {
      return String((error as Error).message);
    }
    throw new Error(`expected failure: ${sql}`);
  });
}

describe('MatchStatus enum (ADR-018 Q5)', () => {
  it('no longer contains KNIFE / MAP_FINISHED, while MatchMapStatus keeps KNIFE', async () => {
    const labels = await withPgClient(async (c) => {
      const r = await c.query<{ t: string; l: string }>(
        `SELECT t.typname AS t, e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname IN ('MatchStatus', 'MatchMapStatus') ORDER BY t.typname, e.enumsortorder`,
      );
      return r.rows;
    });
    expect(labels.filter((x) => x.t === 'MatchStatus').map((x) => x.l)).toEqual([
      'CREATED',
      'SERVER_ASSIGNED',
      'PREPARING',
      'WARMUP',
      'READY_CHECK',
      'LIVE',
      'PAUSED',
      'COMPLETED',
      'CANCELLED',
      'FAILED',
      'DISPUTED',
    ]);
    expect(labels.filter((x) => x.t === 'MatchMapStatus').map((x) => x.l)).toContain('KNIFE');
    expect(Object.values(MatchStatus)).not.toContain('KNIFE');
    expect(Object.values(MatchStatus)).not.toContain('MAP_FINISHED');
    expect(await pgError(`SELECT 'KNIFE'::"MatchStatus"`)).toMatch(/invalid input value/);
    expect(await pgError(`SELECT 'MAP_FINISHED'::"MatchStatus"`)).toMatch(/invalid input value/);
    // Old type is gone and the column default survived the swap.
    await withPgClient(async (c) => {
      const old = await c.query(`SELECT 1 FROM pg_type WHERE typname = 'MatchStatus_old'`);
      expect(old.rowCount).toBe(0);
      const def = await c.query<{ d: string }>(
        `SELECT column_default AS d FROM information_schema.columns
          WHERE table_name = 'matches' AND column_name = 'status'`,
      );
      expect(def.rows[0]?.d).toMatch(/'CREATED'::"MatchStatus"/);
    });
    expect((await newMatch()).status).toBe('CREATED');
  });
});

describe('banned_steam_ids', () => {
  it('allows one active ban per SteamID64; a lifted ban permits a new one', async () => {
    const admin = await newUser();
    const steamId64 = uniqueSteamId64();
    const ban = await prisma.bannedSteamId.create({
      data: { steamId64, reason: 'cheating', createdById: admin.id },
    });
    const err = await expectDbError(
      prisma.bannedSteamId.create({ data: { steamId64, reason: 'again', createdById: admin.id } }),
      re(DB_CONSTRAINTS.steamBanOneActivePerSteamId),
    );
    expect(err).toContain('P2002');
    await prisma.bannedSteamId.update({
      where: { id: ban.id },
      data: { liftedAt: new Date(), liftedById: admin.id, liftReason: 'appeal accepted' },
    });
    await prisma.bannedSteamId.create({
      data: { steamId64, reason: 'second offence', createdById: admin.id },
    });
    expect(await prisma.bannedSteamId.count({ where: { steamId64 } })).toBe(2);
  });

  it('concurrent bans of the same SteamID64: exactly one wins', async () => {
    const admin = await newUser();
    const steamId64 = uniqueSteamId64();
    const results = await Promise.allSettled(
      [1, 2, 3].map((i) =>
        prisma.bannedSteamId.create({
          data: { steamId64, reason: `r${i}`, createdById: admin.id },
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(getDbViolation(r.reason)?.constraint).toBe(
          DB_CONSTRAINTS.steamBanOneActivePerSteamId,
        );
      }
    }
  });

  it('rejects malformed SteamID64, blank reasons and inconsistent lift fields', async () => {
    const admin = await newUser();
    await expectDbError(
      prisma.bannedSteamId.create({
        data: { steamId64: '7656119800000000X', reason: 'x', createdById: admin.id },
      }),
      re(DB_CONSTRAINTS.steamBanSteamIdFormat),
    );
    await expectDbError(
      prisma.bannedSteamId.create({
        data: { steamId64: uniqueSteamId64(), reason: '   ', createdById: admin.id },
      }),
      re(DB_CONSTRAINTS.steamBanReasonNotBlank),
    );
    const ban = await prisma.bannedSteamId.create({
      data: { steamId64: uniqueSteamId64(), reason: 'smurf', createdById: admin.id },
    });
    for (const data of [
      { liftedAt: new Date() },
      { liftedAt: new Date(), liftedById: admin.id },
      { liftedAt: new Date(), liftedById: admin.id, liftReason: ' ' },
      { liftReason: 'no timestamp' },
    ]) {
      await expectDbError(
        prisma.bannedSteamId.update({ where: { id: ban.id }, data }),
        re(DB_CONSTRAINTS.steamBanLiftedFields),
      );
    }
    await expectDbError(
      prisma.bannedSteamId.update({
        where: { id: ban.id },
        data: { liftedAt: new Date('2000-01-01'), liftedById: admin.id, liftReason: 'past' },
      }),
      re(DB_CONSTRAINTS.steamBanLiftedAfterCreated),
    );
  });
});

describe('match_state_transitions', () => {
  it('validates rows and is append-only for the owner (trigger)', async () => {
    const match = await newMatch();
    const admin = await newUser();
    const t = await prisma.matchStateTransition.create({
      data: { matchId: match.id, fromStatus: null, toStatus: 'CREATED', source: 'SYSTEM' },
    });
    await prisma.matchStateTransition.create({
      data: {
        matchId: match.id,
        fromStatus: 'CREATED',
        toStatus: 'COMPLETED',
        source: 'ADMIN',
        actorUserId: admin.id,
        reason: 'result override',
      },
    });
    await expectDbError(
      prisma.matchStateTransition.create({
        data: { matchId: match.id, fromStatus: 'CREATED', toStatus: 'CREATED', source: 'SYSTEM' },
      }),
      re(DB_CONSTRAINTS.matchTransitionChangesStatus),
    );
    await expectDbError(
      prisma.matchStateTransition.create({
        data: { matchId: match.id, fromStatus: 'CREATED', toStatus: 'CANCELLED', source: 'ADMIN' },
      }),
      re(DB_CONSTRAINTS.matchTransitionAdminActor),
    );
    await expectDbError(
      prisma.matchStateTransition.create({
        data: {
          matchId: match.id,
          fromStatus: 'CREATED',
          toStatus: 'CANCELLED',
          source: 'SYSTEM',
          reason: '  ',
        },
      }),
      re(DB_CONSTRAINTS.matchTransitionReasonNotBlank),
    );

    const updateError = await expectDbError(
      prisma.matchStateTransition.update({ where: { id: t.id }, data: { reason: 'tampered' } }),
      /append-only/,
    );
    expect(updateError).toMatch(/match_state_transitions/);
    await expectDbError(
      prisma.matchStateTransition.deleteMany({ where: { matchId: match.id } }),
      /append-only/,
    );
    const deleteError: unknown = await prisma.matchStateTransition
      .delete({ where: { id: t.id } })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(getDbViolation(deleteError)?.kind).toBe('append_only');
    expect(await pgError('TRUNCATE match_state_transitions')).toMatch(/append-only|referenced/);
    expect(await prisma.matchStateTransition.count({ where: { matchId: match.id } })).toBe(2);
  });

  it('allows deliberate maintenance only with the transaction-local flag', async () => {
    const match = await newMatch();
    const t = await prisma.matchStateTransition.create({
      data: { matchId: match.id, toStatus: 'CREATED', source: 'SYSTEM' },
    });
    await withPgClient(async (c) => {
      await c.query('BEGIN');
      await c.query("SET LOCAL rage.allow_append_only_maintenance = 'on'");
      const r = await c.query('DELETE FROM match_state_transitions WHERE id = $1', [t.id]);
      await c.query('COMMIT');
      expect(r.rowCount).toBe(1);
    });
    const t2 = await prisma.matchStateTransition.create({
      data: { matchId: match.id, toStatus: 'CREATED', source: 'SYSTEM' },
    });
    await expectDbError(
      prisma.matchStateTransition.delete({ where: { id: t2.id } }),
      /append-only/,
    );
  });
});

describe('match results', () => {
  it('COMPLETED requires result_source and winner', async () => {
    const match = await newMatch();
    await expectDbError(
      prisma.match.update({
        where: { id: match.id },
        data: { status: 'COMPLETED', winnerTeamId: match.teamAId },
      }),
      re(DB_CONSTRAINTS.matchCompletedResult),
    );
    await expectDbError(
      prisma.match.update({
        where: { id: match.id },
        data: { status: 'COMPLETED', resultSource: 'ADMIN_OVERRIDE' },
      }),
      re(DB_CONSTRAINTS.matchCompletedResult),
    );
    const done = await prisma.match.update({
      where: { id: match.id },
      data: {
        status: 'COMPLETED',
        resultSource: 'ADMIN_OVERRIDE',
        winnerTeamId: match.teamAId,
        teamAScore: 2,
        teamBScore: 1,
        completedAt: new Date(),
      },
    });
    expect(done.resultVerifiedAt).toBeNull();
    // Cannot be marked verified afterwards.
    await expectDbError(
      prisma.match.update({ where: { id: match.id }, data: { resultVerifiedAt: new Date() } }),
      re(DB_CONSTRAINTS.matchAdminResultUnverified),
    );
  });

  it('FORFEIT results are unverified and carry no scores; SERVER results may be verified', async () => {
    const forfeit = await newMatch();
    await expectDbError(
      prisma.match.update({
        where: { id: forfeit.id },
        data: {
          status: 'COMPLETED',
          resultSource: 'FORFEIT',
          winnerTeamId: forfeit.teamBId,
          resultVerifiedAt: new Date(),
        },
      }),
      re(DB_CONSTRAINTS.matchAdminResultUnverified),
    );
    await expectDbError(
      prisma.match.update({
        where: { id: forfeit.id },
        data: {
          status: 'COMPLETED',
          resultSource: 'FORFEIT',
          winnerTeamId: forfeit.teamBId,
          teamAScore: 0,
          teamBScore: 2,
        },
      }),
      re(DB_CONSTRAINTS.matchForfeitNoScores),
    );
    await prisma.match.update({
      where: { id: forfeit.id },
      data: { status: 'COMPLETED', resultSource: 'FORFEIT', winnerTeamId: forfeit.teamBId },
    });

    const server = await newMatch();
    await prisma.match.update({
      where: { id: server.id },
      data: {
        status: 'COMPLETED',
        resultSource: 'SERVER',
        winnerTeamId: server.teamAId,
        teamAScore: 2,
        teamBScore: 0,
        resultVerifiedAt: new Date(),
      },
    });
  });

  it('a non-completed match may stay without result_source (CANCELLED bye)', async () => {
    const match = await newMatch();
    const cancelled = await prisma.match.update({
      where: { id: match.id },
      data: { status: 'CANCELLED', statusReason: 'bye' },
    });
    expect(cancelled.resultSource).toBeNull();
  });
});

describe('tournaments', () => {
  it('max_teams must be within 2..64', async () => {
    for (const maxTeams of [1, 65]) {
      await expectDbError(newTournament({ maxTeams }), re(DB_CONSTRAINTS.tournamentMaxTeams));
    }
    expect((await newTournament({ maxTeams: 64 })).maxTeams).toBe(64);
    expect((await newTournament({ maxTeams: 2 })).maxTeams).toBe(2);
  });

  it('names are unique case-insensitively and not blank', async () => {
    const name = `Major ${uniqueSuffix()}`;
    await newTournament({ name });
    const err = await expectDbError(
      newTournament({ name: name.toUpperCase() }),
      re(DB_CONSTRAINTS.tournamentNameCaseInsensitiveUnique),
    );
    expect(err).toContain('P2002');
    await expectDbError(newTournament({ name: '   ' }), re(DB_CONSTRAINTS.tournamentNameNotBlank));
  });
});

describe('tournament registrations', () => {
  it('seeds are >= 1 and unique among APPROVED registrations of a tournament', async () => {
    const tournament = await newTournament();
    const reviewer = await newUser();
    const approve = (id: string, seed: number | null) =>
      prisma.tournamentRegistration.update({
        where: { id },
        data: { status: 'APPROVED', seed, reviewedById: reviewer.id, reviewedAt: new Date() },
      });
    const [r1, r2, r3] = [
      await newRegistration(tournament.id),
      await newRegistration(tournament.id),
      await newRegistration(tournament.id),
    ];
    await expectDbError(approve(r1.id, 0), re(DB_CONSTRAINTS.registrationSeedPositive));
    await approve(r1.id, 1);
    await expectDbError(approve(r2.id, 1), re(DB_CONSTRAINTS.registrationApprovedSeedUnique));
    // A PENDING registration may carry the same number (not part of the seeding).
    await prisma.tournamentRegistration.update({ where: { id: r3.id }, data: { seed: 1 } });
    // Unseeded APPROVED registrations coexist.
    await approve(r2.id, null);
    // Re-seeding pattern: clear, then assign (swap 1 <-> 2).
    await approve(r2.id, 2);
    await prisma.$transaction([
      prisma.tournamentRegistration.updateMany({
        where: { tournamentId: tournament.id, status: 'APPROVED' },
        data: { seed: null },
      }),
      prisma.tournamentRegistration.update({ where: { id: r1.id }, data: { seed: 2 } }),
      prisma.tournamentRegistration.update({ where: { id: r2.id }, data: { seed: 1 } }),
    ]);
    // Same seed in another tournament is fine.
    const other = await newRegistration();
    await approve(other.id, 1);
  });
});

describe('tournament roster snapshots', () => {
  async function entry(rosterId: string, nickname = 'snap') {
    const u = await newUser();
    return prisma.tournamentRosterEntry.create({
      data: {
        rosterId,
        userId: u.id,
        steamId64Snapshot: u.steamId64,
        nicknameSnapshot: nickname,
        role: 'STARTER',
      },
    });
  }

  it('one current (DRAFT/LOCKED) roster per registration; versions supersede', async () => {
    const reg = await newRegistration();
    const admin = await newUser();
    const v1 = await prisma.tournamentRoster.create({
      data: { registrationId: reg.id, version: 1 },
    });
    await expectDbError(
      prisma.tournamentRoster.create({ data: { registrationId: reg.id, version: 2 } }),
      re(DB_CONSTRAINTS.rosterOneCurrentPerRegistration),
    );
    // PUT .../roster: never-locked DRAFT → SUPERSEDED, then v2 DRAFT.
    await prisma.tournamentRoster.update({ where: { id: v1.id }, data: { status: 'SUPERSEDED' } });
    const v2 = await prisma.tournamentRoster.create({
      data: { registrationId: reg.id, version: 2, supersedesRosterId: v1.id },
    });
    // Approve: DRAFT → LOCKED.
    await prisma.tournamentRoster.update({
      where: { id: v2.id },
      data: { status: 'LOCKED', lockedAt: new Date(), lockedById: admin.id },
    });
    // Substitution: LOCKED → SUPERSEDED, new LOCKED version.
    await expectDbError(
      prisma.tournamentRoster.create({
        data: { registrationId: reg.id, version: 3, status: 'LOCKED', lockedAt: new Date() },
      }),
      /tournament_rosters_one_(current|locked)_per_registration_uniq/,
    );
    await prisma.tournamentRoster.update({ where: { id: v2.id }, data: { status: 'SUPERSEDED' } });
    await prisma.tournamentRoster.create({
      data: {
        registrationId: reg.id,
        version: 3,
        status: 'LOCKED',
        lockedAt: new Date(),
        lockedById: admin.id,
        supersedesRosterId: v2.id,
        changeReason: 'injury substitution',
      },
    });
  });

  it('concurrent DRAFT inserts for one registration: exactly one wins', async () => {
    const reg = await newRegistration();
    const results = await Promise.allSettled(
      [1, 2, 3].map((version) =>
        prisma.tournamentRoster.create({ data: { registrationId: reg.id, version } }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('lock fields: LOCKED needs locked_at, DRAFT has none; change_reason not blank', async () => {
    const reg = await newRegistration();
    const admin = await newUser();
    await expectDbError(
      prisma.tournamentRoster.create({
        data: { registrationId: reg.id, version: 1, status: 'LOCKED' },
      }),
      re(DB_CONSTRAINTS.rosterLockedFields),
    );
    await expectDbError(
      prisma.tournamentRoster.create({
        data: { registrationId: reg.id, version: 1, lockedAt: new Date() },
      }),
      re(DB_CONSTRAINTS.rosterLockedFields),
    );
    await expectDbError(
      prisma.tournamentRoster.create({
        data: { registrationId: reg.id, version: 1, lockedById: admin.id },
      }),
      re(DB_CONSTRAINTS.rosterLockedFields),
    );
    await expectDbError(
      prisma.tournamentRoster.create({
        data: { registrationId: reg.id, version: 1, changeReason: ' ' },
      }),
      re(DB_CONSTRAINTS.rosterChangeReasonNotBlank),
    );
  });

  it('status only moves forward and identity/lock columns are frozen (trigger)', async () => {
    const reg = await newRegistration();
    const admin = await newUser();
    const roster = await prisma.tournamentRoster.create({
      data: {
        registrationId: reg.id,
        version: 1,
        status: 'LOCKED',
        lockedAt: new Date(),
        lockedById: admin.id,
      },
    });
    for (const data of [
      { status: 'DRAFT' as const, lockedAt: null, lockedById: null },
      { version: 7 },
      { lockedAt: new Date(Date.now() + 1000) },
    ]) {
      await expectDbError(
        prisma.tournamentRoster.update({ where: { id: roster.id }, data }),
        /is immutable/,
      );
    }
    const versionError: unknown = await prisma.tournamentRoster
      .update({ where: { id: roster.id }, data: { version: 9 } })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(getDbViolation(versionError)?.kind).toBe('immutable');
    await expectDbError(prisma.tournamentRoster.delete({ where: { id: roster.id } }), /immutable/);
    await prisma.tournamentRoster.update({
      where: { id: roster.id },
      data: { status: 'SUPERSEDED' },
    });
    await expectDbError(
      prisma.tournamentRoster.update({ where: { id: roster.id }, data: { status: 'LOCKED' } }),
      /is immutable/,
    );
  });

  it('entries are never updated; entries of a non-DRAFT roster are never deleted', async () => {
    const reg = await newRegistration();
    const admin = await newUser();
    const draft = await prisma.tournamentRoster.create({
      data: { registrationId: reg.id, version: 1 },
    });
    const e1 = await entry(draft.id, 'before');
    await expectDbError(
      prisma.tournamentRosterEntry.update({
        where: { id: e1.id },
        data: { nicknameSnapshot: 'after' },
      }),
      /is immutable/,
    );
    // No-op upsert (seed:sample pattern) is tolerated.
    await prisma.tournamentRosterEntry.upsert({
      where: { rosterId_userId: { rosterId: draft.id, userId: e1.userId } },
      create: {
        rosterId: draft.id,
        userId: e1.userId,
        steamId64Snapshot: e1.steamId64Snapshot,
        nicknameSnapshot: 'before',
        role: 'STARTER',
      },
      update: {},
    });
    // DRAFT entries may be deleted.
    const e2 = await entry(draft.id);
    await prisma.tournamentRosterEntry.delete({ where: { id: e2.id } });

    await prisma.tournamentRoster.update({
      where: { id: draft.id },
      data: { status: 'LOCKED', lockedAt: new Date(), lockedById: admin.id },
    });
    await expectDbError(prisma.tournamentRosterEntry.delete({ where: { id: e1.id } }), /immutable/);
    expect(await pgError('TRUNCATE tournament_roster_entries')).toMatch(/immutable|referenced/);
    // A snapshot survives later profile changes: it is a copy, not a reference.
    const stored = await prisma.tournamentRosterEntry.findUniqueOrThrow({ where: { id: e1.id } });
    expect(stored.nicknameSnapshot).toBe('before');

    // Maintenance escape hatch (transaction-local).
    await withPgClient(async (c) => {
      await c.query('BEGIN');
      await c.query("SET LOCAL rage.allow_append_only_maintenance = 'on'");
      await c.query(
        `UPDATE tournament_roster_entries SET nickname_snapshot = 'fixed' WHERE id = $1`,
        [e1.id],
      );
      await c.query('ROLLBACK');
    });
  });

  it('rejects blank nickname snapshots', async () => {
    const reg = await newRegistration();
    const roster = await prisma.tournamentRoster.create({
      data: { registrationId: reg.id, version: 1 },
    });
    await expectDbError(entry(roster.id, '  '), re(DB_CONSTRAINTS.rosterEntryNicknameNotBlank));
  });
});

describe('veto and maps', () => {
  it('veto map names must match ^de_[a-z0-9_]{2,30}$', async () => {
    const match = await newMatch();
    for (const mapName of [
      'DE_DUST2',
      'cs_office',
      'de_',
      'de_x',
      `de_${'a'.repeat(31)}`,
      'de_dust 2',
    ]) {
      await expectDbError(
        prisma.mapVetoAction.create({
          data: { matchId: match.id, sequence: 1, action: 'BAN', mapName },
        }),
        re(DB_CONSTRAINTS.vetoMapNameFormat),
      );
    }
    await prisma.mapVetoAction.create({
      data: { matchId: match.id, sequence: 1, action: 'BAN', mapName: 'de_dust2' },
    });
  });

  it('a map is BAN/PICK/DECIDER once per match; concurrent submissions for one turn: one wins', async () => {
    const match = await newMatch();
    await prisma.mapVetoAction.create({
      data: { matchId: match.id, sequence: 1, action: 'PICK', mapName: 'de_mirage' },
    });
    await expectDbError(
      prisma.mapVetoAction.create({
        data: { matchId: match.id, sequence: 2, action: 'DECIDER', mapName: 'de_mirage' },
      }),
      re(DB_CONSTRAINTS.vetoMapOncePerMatch),
    );
    // SIDE_PICK refers to the picked map (M4) and is deliberately allowed.
    await prisma.mapVetoAction.create({
      data: {
        matchId: match.id,
        sequence: 2,
        action: 'SIDE_PICK',
        mapName: 'de_mirage',
        side: 'CT',
      },
    });
    const results = await Promise.allSettled(
      ['de_inferno', 'de_nuke', 'de_train'].map((mapName) =>
        prisma.mapVetoAction.create({
          data: { matchId: match.id, sequence: 3, action: 'BAN', mapName },
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(getDbViolation(r.reason)?.constraint).toBe(DB_CONSTRAINTS.vetoSequenceUnique);
      }
    }
  });

  it('match_maps: a map appears once per match', async () => {
    const match = await newMatch();
    await prisma.matchMap.create({
      data: { matchId: match.id, mapOrder: 1, mapName: 'de_anubis' },
    });
    await expectDbError(
      prisma.matchMap.create({ data: { matchId: match.id, mapOrder: 2, mapName: 'de_anubis' } }),
      re(DB_CONSTRAINTS.matchMapNameUnique),
    );
    await expectDbError(
      prisma.matchMap.create({ data: { matchId: match.id, mapOrder: 1, mapName: 'de_ancient' } }),
      re(DB_CONSTRAINTS.matchMapOrderUnique),
    );
  });
});

describe('brackets', () => {
  it('slot numbers >= 1, no self-link, one winner per next position, one match per slot', async () => {
    const tournament = await newTournament();
    const stage = await prisma.tournamentStage.create({
      data: {
        tournamentId: tournament.id,
        name: 'Playoffs',
        format: 'SINGLE_ELIMINATION',
        sequence: 1,
      },
    });
    const bracket = await prisma.bracket.create({
      data: { stageId: stage.id, generationVersion: 1 },
    });
    await expectDbError(
      prisma.bracket.create({ data: { stageId: stage.id, generationVersion: 1 } }),
      re(DB_CONSTRAINTS.bracketGenerationUnique),
    );
    for (const [roundNumber, slotNumber] of [
      [0, 1],
      [1, 0],
    ] as const) {
      await expectDbError(
        prisma.bracketSlot.create({ data: { bracketId: bracket.id, roundNumber, slotNumber } }),
        re(DB_CONSTRAINTS.bracketSlotNumbers),
      );
    }
    const final = await prisma.bracketSlot.create({
      data: { bracketId: bracket.id, roundNumber: 2, slotNumber: 1 },
    });
    const selfId = randomUUID();
    await expectDbError(
      prisma.bracketSlot.create({
        data: {
          id: selfId,
          bracketId: bracket.id,
          roundNumber: 1,
          slotNumber: 9,
          nextSlotId: selfId,
          nextSlotPosition: 'A',
        },
      }),
      re(DB_CONSTRAINTS.bracketSlotNotSelf),
    );
    const semi1 = await prisma.bracketSlot.create({
      data: {
        bracketId: bracket.id,
        roundNumber: 1,
        slotNumber: 1,
        nextSlotId: final.id,
        nextSlotPosition: 'A',
      },
    });
    await expectDbError(
      prisma.bracketSlot.create({
        data: {
          bracketId: bracket.id,
          roundNumber: 1,
          slotNumber: 2,
          nextSlotId: final.id,
          nextSlotPosition: 'A',
        },
      }),
      re(DB_CONSTRAINTS.bracketSlotNextPositionUnique),
    );
    await prisma.match.create({ data: { tournamentId: tournament.id, bracketSlotId: semi1.id } });
    await expectDbError(
      prisma.match.create({ data: { tournamentId: tournament.id, bracketSlotId: semi1.id } }),
      re(DB_CONSTRAINTS.matchBracketSlotUnique),
    );
  });
});

describe('migration 20261114000000_m3_tournaments (replayed in an isolated schema)', () => {
  const SCHEMA = 'm3_preflight_it';
  const dir = path.resolve(import.meta.dirname, '..', 'prisma', 'migrations');
  const migrationSql = (name: string) =>
    readFileSync(path.join(dir, name, 'migration.sql'), 'utf8');
  const BEFORE_M3 = [
    '20261111000000_init',
    '20261111020000_sample_steam_id_consistency',
    '20261113000000_m2_teams',
  ];
  const M3 = '20261114000000_m3_tournaments';

  it('aborts atomically while KNIFE / MAP_FINISHED rows exist, then applies without data loss', async () => {
    await withPgClient(async (c) => {
      await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await c.query(`CREATE SCHEMA ${SCHEMA}`);
      await c.query(`SET search_path TO ${SCHEMA}`);
      try {
        // Simple-query protocol: each file runs as one implicit transaction, like Prisma.
        for (const name of BEFORE_M3) await c.query(migrationSql(name));
        const [knife, mapFinished, live] = [randomUUID(), randomUUID(), randomUUID()];
        await c.query(
          `INSERT INTO matches (id, status, updated_at)
           VALUES ($1, 'KNIFE', now()), ($2, 'MAP_FINISHED', now()), ($3, 'LIVE', now())`,
          [knife, mapFinished, live],
        );

        await expect(c.query(migrationSql(M3))).rejects.toThrow(
          /2 match row\(s\) still use MatchStatus KNIFE\/MAP_FINISHED/,
        );
        // Nothing from M3 was applied.
        const labels = await c.query<{ l: string }>(
          `SELECT enumlabel AS l FROM pg_enum WHERE enumtypid = '"MatchStatus"'::regtype`,
        );
        expect(labels.rows.map((r) => r.l)).toEqual(
          expect.arrayContaining(['KNIFE', 'MAP_FINISHED']),
        );
        const created = await c.query<{ t: string | null }>(
          `SELECT to_regclass('banned_steam_ids')::text AS t`,
        );
        expect(created.rows[0]?.t).toBeNull();

        // Operator fixes the rows (series state; map state belongs in match_maps.status).
        await c.query(
          `UPDATE matches SET status = 'LIVE' WHERE status IN ('KNIFE', 'MAP_FINISHED')`,
        );
        await c.query(migrationSql(M3));

        const rows = await c.query<{ id: string; status: string }>(
          `SELECT id, status::text AS status FROM matches ORDER BY id`,
        );
        expect(rows.rows).toHaveLength(3);
        expect(new Set(rows.rows.map((r) => r.status))).toEqual(new Set(['LIVE']));
        const inserted = await c.query<{ status: string }>(
          `INSERT INTO matches (id, updated_at) VALUES ($1, now()) RETURNING status::text AS status`,
          [randomUUID()],
        );
        expect(inserted.rows[0]?.status).toBe('CREATED');
      } finally {
        await c.query('RESET search_path');
        await c.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      }
    });
  });
});

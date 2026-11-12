import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_CONSTRAINTS, type PrismaClient } from '../src/index.js';
import { getDbViolation } from '../src/errors.js';
import {
  createTestPrisma,
  expectDbError,
  uniqueSteamId64,
  uniqueSuffix,
  withPgClient,
} from './helpers/test-db.js';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const newUser = () => prisma.user.create({ data: { steamId64: uniqueSteamId64() } });

async function newTeam(name = `Team ${uniqueSuffix()}`) {
  const s = uniqueSuffix();
  return prisma.team.create({ data: { name, tag: `T${s}`.slice(0, 10), slug: `team-${s}` } });
}

async function newServer() {
  return prisma.gameServer.create({
    data: {
      name: `srv-${uniqueSuffix()}`,
      providerType: 'DEDICATED',
      address: '127.0.0.1',
      gamePort: 27015,
    },
  });
}

async function newMatch() {
  const [a, b] = [await newTeam(), await newTeam()];
  return prisma.match.create({ data: { teamAId: a.id, teamBId: b.id, format: 'BO1' } });
}

describe('identity constraints', () => {
  it('rejects a duplicate steam_id64', async () => {
    const steamId64 = uniqueSteamId64();
    await prisma.user.create({ data: { steamId64 } });
    const err = await expectDbError(
      prisma.user.create({ data: { steamId64 } }),
      /users_steam_id64_key/,
    );
    expect(err).toContain('P2002');
  });

  it('rejects malformed steam_id64 via CHECK', async () => {
    for (const bad of ['7656119800000000x', '1234', '-7656119800000000', '7656119800000000 ']) {
      await expectDbError(
        prisma.user.create({ data: { steamId64: bad } }),
        /users_steam_id64_format_chk|value too long/,
      );
    }
  });

  it('binds is_sample to the reserved sample SteamID range (both directions)', async () => {
    // Sample-range ID that claims to be a real account.
    await expectDbError(
      prisma.user.create({ data: { steamId64: '76561190000000500', isSample: false } }),
      /users_sample_steam_id_range_chk/,
    );
    // Real-range ID flagged as sample.
    await expectDbError(
      prisma.user.create({ data: { steamId64: uniqueSteamId64(), isSample: true } }),
      /users_sample_steam_id_range_chk/,
    );
    // Range edges: 000 and 1000 are outside the sample range.
    await expectDbError(
      prisma.user.create({ data: { steamId64: '76561190000000000', isSample: true } }),
      /users_sample_steam_id_range_chk/,
    );
    await expectDbError(
      prisma.user.create({ data: { steamId64: '76561190000001000', isSample: true } }),
      /users_sample_steam_id_range_chk/,
    );
    // A real user cannot be flipped to sample afterwards.
    const real = await newUser();
    await expectDbError(
      prisma.user.update({ where: { id: real.id }, data: { isSample: true } }),
      /users_sample_steam_id_range_chk/,
    );
    // Valid combinations are accepted.
    const sample = await prisma.user.create({
      data: { steamId64: '76561190000000999', isSample: true },
    });
    expect(sample.isSample).toBe(true);
    await prisma.user.delete({ where: { id: sample.id } });
  });

  it('rejects a duplicate active role grant but allows re-grant after revoke', async () => {
    const u = await newUser();
    const g = await prisma.userRoleGrant.create({ data: { userId: u.id, role: 'SUPER_ADMIN' } });
    await expectDbError(
      prisma.userRoleGrant.create({ data: { userId: u.id, role: 'SUPER_ADMIN' } }),
      new RegExp(DB_CONSTRAINTS.roleGrantActiveUnique),
    );
    await prisma.userRoleGrant.update({ where: { id: g.id }, data: { revokedAt: new Date() } });
    await prisma.userRoleGrant.create({ data: { userId: u.id, role: 'SUPER_ADMIN' } });
  });

  it('requires scope_id iff scope is not GLOBAL', async () => {
    const u = await newUser();
    await expectDbError(
      prisma.userRoleGrant.create({
        data: { userId: u.id, role: 'TEAM_MANAGER', scopeType: 'TEAM' },
      }),
      /user_role_grants_scope_chk/,
    );
  });
});

describe('team application constraints', () => {
  it('allows only one PENDING application per applicant', async () => {
    const u = await newUser();
    const s1 = uniqueSuffix();
    const first = await prisma.teamApplication.create({
      data: {
        applicantUserId: u.id,
        requestedName: `A ${s1}`,
        requestedTag: 'A',
        requestedSlug: `a-${s1}`,
      },
    });
    const s2 = uniqueSuffix();
    const err = await expectDbError(
      prisma.teamApplication.create({
        data: {
          applicantUserId: u.id,
          requestedName: `B ${s2}`,
          requestedTag: 'B',
          requestedSlug: `b-${s2}`,
        },
      }),
      new RegExp(DB_CONSTRAINTS.applicationOnePendingPerApplicant),
    );
    expect(err).toContain('P2002');
    // After rejection (with reviewer + reason) a new application is allowed.
    const admin = await newUser();
    await prisma.teamApplication.update({
      where: { id: first.id },
      data: {
        status: 'REJECTED',
        reviewedById: admin.id,
        reviewedAt: new Date(),
        reviewReason: 'Name not allowed',
      },
    });
    await prisma.teamApplication.create({
      data: {
        applicantUserId: u.id,
        requestedName: `B ${s2}`,
        requestedTag: 'B',
        requestedSlug: `b-${s2}`,
      },
    });
  });

  it('rejects APPROVED without a created team and REJECTED without a reason', async () => {
    const u = await newUser();
    const admin = await newUser();
    const s = uniqueSuffix();
    const app = await prisma.teamApplication.create({
      data: {
        applicantUserId: u.id,
        requestedName: `C ${s}`,
        requestedTag: 'C',
        requestedSlug: `c-${s}`,
      },
    });
    await expectDbError(
      prisma.teamApplication.update({
        where: { id: app.id },
        data: { status: 'APPROVED', reviewedById: admin.id, reviewedAt: new Date() },
      }),
      /team_applications_approved_team_chk/,
    );
    await expectDbError(
      prisma.teamApplication.update({
        where: { id: app.id },
        data: {
          status: 'REJECTED',
          reviewedById: admin.id,
          reviewedAt: new Date(),
          reviewReason: '  ',
        },
      }),
      /team_applications_reject_reason_chk/,
    );
  });

  it('an application can create at most one team (approval idempotency)', async () => {
    const admin = await newUser();
    const team = await newTeam();
    const mk = async () => {
      const u = await newUser();
      const s = uniqueSuffix();
      return prisma.teamApplication.create({
        data: {
          applicantUserId: u.id,
          requestedName: `D ${s}`,
          requestedTag: 'D',
          requestedSlug: `d-${s}`,
        },
      });
    };
    const [a1, a2] = [await mk(), await mk()];
    const approve = (id: string) =>
      prisma.teamApplication.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedById: admin.id,
          reviewedAt: new Date(),
          createdTeamId: team.id,
        },
      });
    await approve(a1.id);
    await expectDbError(approve(a2.id), new RegExp(DB_CONSTRAINTS.applicationCreatedTeamUnique));
  });
});

describe('team constraints', () => {
  it('rejects case-insensitive duplicate team names and tags', async () => {
    const s = uniqueSuffix();
    await prisma.team.create({
      data: { name: `Falcons ${s}`, tag: `F${s}`.slice(0, 10), slug: `falcons-${s}` },
    });
    await expectDbError(
      prisma.team.create({
        data: { name: `FALCONS ${s}`.toUpperCase(), tag: 'ZZZ', slug: `falcons-2-${s}` },
      }),
      new RegExp(DB_CONSTRAINTS.teamNameCaseInsensitiveUnique),
    );
    await expectDbError(
      prisma.team.create({
        data: { name: `Other ${s}`, tag: `f${s}`.slice(0, 10).toLowerCase(), slug: `other-${s}` },
      }),
      new RegExp(DB_CONSTRAINTS.teamTagCaseInsensitiveUnique),
    );
  });

  it('rejects non-lowercase slugs', async () => {
    await expectDbError(
      prisma.team.create({
        data: { name: `Slug ${uniqueSuffix()}`, tag: 'SLG', slug: 'Bad-Slug' },
      }),
      /teams_slug_format_chk/,
    );
  });
});

describe('membership constraints', () => {
  it('allows only one active membership per user, keeping history', async () => {
    const u = await newUser();
    const [t1, t2] = [await newTeam(), await newTeam()];
    const m1 = await prisma.teamMembership.create({
      data: { teamId: t1.id, userId: u.id, role: 'PLAYER' },
    });
    await expectDbError(
      prisma.teamMembership.create({ data: { teamId: t2.id, userId: u.id, role: 'PLAYER' } }),
      new RegExp(DB_CONSTRAINTS.membershipOneActivePerUser),
    );
    await prisma.teamMembership.update({
      where: { id: m1.id },
      data: { leftAt: new Date(), leftReason: 'released' },
    });
    await prisma.teamMembership.create({ data: { teamId: t2.id, userId: u.id, role: 'PLAYER' } });
    expect(await prisma.teamMembership.count({ where: { userId: u.id } })).toBe(2);
  });

  it('allows only one active CAPTAIN per team', async () => {
    const t = await newTeam();
    const [c1, c2] = [await newUser(), await newUser()];
    await prisma.teamMembership.create({ data: { teamId: t.id, userId: c1.id, role: 'CAPTAIN' } });
    await expectDbError(
      prisma.teamMembership.create({ data: { teamId: t.id, userId: c2.id, role: 'CAPTAIN' } }),
      new RegExp(DB_CONSTRAINTS.membershipOneActiveCaptainPerTeam),
    );
  });

  it('concurrent second captain inserts: exactly one wins', async () => {
    const t = await newTeam();
    const users = await Promise.all([newUser(), newUser(), newUser()]);
    const results = await Promise.allSettled(
      users.map((u) =>
        prisma.teamMembership.create({ data: { teamId: t.id, userId: u.id, role: 'CAPTAIN' } }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(getDbViolation(r.reason)?.constraint).toBe(
          DB_CONSTRAINTS.membershipOneActiveCaptainPerTeam,
        );
      }
    }
  });

  it('allows only one PENDING invitation per (team, invitee)', async () => {
    const t = await newTeam();
    const [captain, invitee] = [await newUser(), await newUser()];
    const expiresAt = new Date(Date.now() + 86_400_000);
    const inv = await prisma.teamInvitation.create({
      data: { teamId: t.id, inviteeUserId: invitee.id, invitedById: captain.id, expiresAt },
    });
    await expectDbError(
      prisma.teamInvitation.create({
        data: { teamId: t.id, inviteeUserId: invitee.id, invitedById: captain.id, expiresAt },
      }),
      new RegExp(DB_CONSTRAINTS.invitationOnePendingPerTeamInvitee),
    );
    await prisma.teamInvitation.update({
      where: { id: inv.id },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });
    await prisma.teamInvitation.create({
      data: { teamId: t.id, inviteeUserId: invitee.id, invitedById: captain.id, expiresAt },
    });
  });
});

describe('tournament roster constraints', () => {
  it('rejects duplicate steam_id64 snapshot within a roster and a second LOCKED roster', async () => {
    const team = await newTeam();
    const captain = await newUser();
    const s = uniqueSuffix();
    const tournament = await prisma.tournament.create({
      data: { slug: `cup-${s}`, name: `Cup ${s}`, format: 'SINGLE_ELIMINATION' },
    });
    const reg = await prisma.tournamentRegistration.create({
      data: { tournamentId: tournament.id, teamId: team.id, requestedById: captain.id },
    });
    const roster = await prisma.tournamentRoster.create({
      data: { registrationId: reg.id, version: 1, status: 'LOCKED', lockedAt: new Date() },
    });
    const [p1, p2] = [await newUser(), await newUser()];
    await prisma.tournamentRosterEntry.create({
      data: {
        rosterId: roster.id,
        userId: p1.id,
        steamId64Snapshot: p1.steamId64,
        nicknameSnapshot: 'p1',
        role: 'STARTER',
      },
    });
    await expectDbError(
      prisma.tournamentRosterEntry.create({
        data: {
          rosterId: roster.id,
          userId: p2.id,
          steamId64Snapshot: p1.steamId64,
          nicknameSnapshot: 'p2',
          role: 'STARTER',
        },
      }),
      new RegExp(DB_CONSTRAINTS.rosterEntrySteamIdUnique),
    );
    await expectDbError(
      prisma.tournamentRoster.create({
        data: { registrationId: reg.id, version: 2, status: 'LOCKED', lockedAt: new Date() },
      }),
      new RegExp(DB_CONSTRAINTS.rosterOneLockedPerRegistration),
    );
    await expectDbError(
      prisma.tournamentRegistration.create({
        data: { tournamentId: tournament.id, teamId: team.id, requestedById: captain.id },
      }),
      new RegExp(DB_CONSTRAINTS.registrationTournamentTeamUnique),
    );
  });
});

describe('match constraints', () => {
  it('rejects negative scores, same-team matches and non-participant winners', async () => {
    const match = await newMatch();
    await expectDbError(
      prisma.matchMap.create({
        data: { matchId: match.id, mapOrder: 1, mapName: 'de_ancient', teamAScore: -1 },
      }),
      /match_maps_scores_non_negative_chk/,
    );
    await expectDbError(
      prisma.match.update({ where: { id: match.id }, data: { teamAScore: -1 } }),
      /matches_scores_non_negative_chk/,
    );
    const outsider = await newTeam();
    await expectDbError(
      prisma.match.update({ where: { id: match.id }, data: { winnerTeamId: outsider.id } }),
      /matches_winner_is_participant_chk/,
    );
    await expectDbError(
      prisma.match.create({ data: { teamAId: outsider.id, teamBId: outsider.id } }),
      /matches_distinct_teams_chk/,
    );
  });

  it('rejects banning the same map twice in one match', async () => {
    const match = await newMatch();
    await prisma.mapVetoAction.create({
      data: { matchId: match.id, sequence: 1, action: 'BAN', mapName: 'de_nuke' },
    });
    await expectDbError(
      prisma.mapVetoAction.create({
        data: { matchId: match.id, sequence: 2, action: 'PICK', mapName: 'de_nuke' },
      }),
      new RegExp(DB_CONSTRAINTS.vetoMapOncePerMatch),
    );
  });
});

describe('server constraints', () => {
  it('allows one active allocation per server and per match; release frees the server', async () => {
    const server = await newServer();
    const [m1, m2] = [await newMatch(), await newMatch()];
    const lease = () => new Date(Date.now() + 3_600_000);
    const a1 = await prisma.serverAllocation.create({
      data: { serverId: server.id, matchId: m1.id, leaseExpiresAt: lease() },
    });
    await expectDbError(
      prisma.serverAllocation.create({
        data: { serverId: server.id, matchId: m2.id, leaseExpiresAt: lease() },
      }),
      new RegExp(DB_CONSTRAINTS.allocationOneActivePerServer),
    );
    const other = await newServer();
    await expectDbError(
      prisma.serverAllocation.create({
        data: { serverId: other.id, matchId: m1.id, leaseExpiresAt: lease() },
      }),
      new RegExp(DB_CONSTRAINTS.allocationOneActivePerMatch),
    );
    await prisma.serverAllocation.update({
      where: { id: a1.id },
      data: { releasedAt: new Date() },
    });
    await prisma.serverAllocation.create({
      data: { serverId: server.id, matchId: m2.id, leaseExpiresAt: lease() },
    });
  });

  it('command requests: enum allowlist and JSON object payload only', async () => {
    const server = await newServer();
    const deadline = new Date(Date.now() + 30_000);
    await prisma.serverCommandRequest.create({
      data: { serverId: server.id, commandType: 'PAUSE_MATCH', deadline },
    });
    await expectDbError(
      prisma.serverCommandRequest.create({
        data: { serverId: server.id, commandType: 'PAUSE_MATCH', deadline, payload: [1, 2] },
      }),
      /server_command_requests_payload_object_chk/,
    );
    // Free-form command text cannot be stored: invalid enum values are rejected by Postgres.
    await withPgClient(async (c) => {
      await expect(
        c.query(
          `INSERT INTO server_command_requests (id, server_id, command_type, deadline, updated_at)
           VALUES (gen_random_uuid(), $1, 'rcon_password hunter2', now() + interval '1 minute', now())`,
          [server.id],
        ),
      ).rejects.toThrow(/invalid input value for enum/);
    });
  });
});

describe('match events', () => {
  it('rejects duplicate (source_server_id, external_event_id) but accepts same id from another server', async () => {
    const [server, other] = [await newServer(), await newServer()];
    const match = await newMatch();
    const event = (sourceServerId: string) =>
      prisma.matchEvent.create({
        data: {
          sourceServerId,
          externalEventId: 'evt-1',
          matchId: match.id,
          eventType: 'round_end',
          sequence: 1n,
          payloadJson: {},
          occurredAt: new Date(),
        },
      });
    await event(server.id);
    await expectDbError(event(server.id), new RegExp(DB_CONSTRAINTS.matchEventSourceUnique));
    await event(other.id);
  });
});

describe('append-only tables', () => {
  it('rejects UPDATE/DELETE on audit_logs and match_events', async () => {
    const log = await prisma.auditLog.create({
      data: { action: 'test.create', resourceType: 'test' },
    });
    await expectDbError(
      prisma.auditLog.update({ where: { id: log.id }, data: { action: 'tampered' } }),
      /append-only/,
    );
    await expectDbError(prisma.auditLog.delete({ where: { id: log.id } }), /append-only/);

    const server = await newServer();
    const match = await newMatch();
    const ev = await prisma.matchEvent.create({
      data: {
        sourceServerId: server.id,
        externalEventId: 'e',
        matchId: match.id,
        eventType: 'x',
        payloadJson: {},
        occurredAt: new Date(),
      },
    });
    await expectDbError(
      prisma.matchEvent.update({ where: { id: ev.id }, data: { eventType: 'y' } }),
      /append-only/,
    );
    await expectDbError(prisma.matchEvent.deleteMany({ where: { id: ev.id } }), /append-only/);

    await withPgClient(async (c) => {
      await expect(c.query('TRUNCATE audit_logs')).rejects.toThrow(/append-only/);
    });
    expect(await prisma.auditLog.count({ where: { id: log.id } })).toBe(1);
  });

  it('allows deliberate maintenance only with the session flag inside a transaction', async () => {
    const log = await prisma.auditLog.create({
      data: { action: 'test.prune', resourceType: 'test' },
    });
    await withPgClient(async (c) => {
      await c.query('BEGIN');
      await c.query("SET LOCAL rage.allow_append_only_maintenance = 'on'");
      const r = await c.query('DELETE FROM audit_logs WHERE id = $1', [log.id]);
      await c.query('COMMIT');
      expect(r.rowCount).toBe(1);
      // The flag was transaction-local: protection is back.
      await expect(
        c.query("UPDATE audit_logs SET action = 'x' WHERE action = 'test.create'"),
      ).rejects.toThrow(/append-only/);
    });
  });
});

describe('constraint name registry', () => {
  it('every DB_CONSTRAINTS entry exists as a constraint or index', async () => {
    const names = Object.values(DB_CONSTRAINTS);
    const found = await withPgClient(async (c) => {
      const r = await c.query<{ name: string }>(
        `SELECT conname AS name FROM pg_constraint WHERE conname = ANY($1)
         UNION SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)`,
        [names],
      );
      return new Set(r.rows.map((row) => row.name));
    });
    expect(names.filter((n) => !found.has(n))).toEqual([]);
  });
});

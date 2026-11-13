// M2 constraints (docs/TEAMS.md, ADR-019; migration 20261113000000_m2_teams).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_CONSTRAINTS, Prisma, type PrismaClient } from '../src/index.js';
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

async function newTeam(tag = uniqueTag()) {
  const s = uniqueSuffix();
  return prisma.team.create({ data: { name: `Team ${s}`, tag, slug: `team-${s}` } });
}

async function newApplication(requestedTag: string, applicantUserId?: string) {
  const s = uniqueSuffix();
  return prisma.teamApplication.create({
    data: {
      applicantUserId: applicantUserId ?? (await newUser()).id,
      requestedName: `App ${s}`,
      requestedTag,
      requestedSlug: `app-${s}`,
    },
  });
}

describe('team_applications_pending_tag_ci_uniq', () => {
  it('rejects a second PENDING application with the same tag, case-insensitively', async () => {
    const tag = uniqueTag('P');
    await newApplication(tag);
    const err = await expectDbError(
      newApplication(tag.toLowerCase()),
      re(DB_CONSTRAINTS.applicationPendingTagUnique),
    );
    expect(err).toContain('P2002');
  });

  it('only applies among PENDING applications', async () => {
    const tag = uniqueTag('Q');
    const admin = await newUser();
    const first = await newApplication(tag);
    await prisma.teamApplication.update({
      where: { id: first.id },
      data: {
        status: 'REJECTED',
        reviewedById: admin.id,
        reviewedAt: new Date(),
        reviewReason: 'tag clash',
      },
    });
    const second = await newApplication(tag);
    await prisma.teamApplication.update({
      where: { id: second.id },
      data: { status: 'WITHDRAWN' },
    });
    // Two non-pending rows with the same tag coexist, and a new PENDING one is allowed.
    await newApplication(tag.toLowerCase());
    expect(
      await prisma.teamApplication.count({
        where: { requestedTag: { equals: tag, mode: 'insensitive' } },
      }),
    ).toBe(3);
  });

  it('concurrent PENDING submissions of one tag: exactly one wins', async () => {
    const tag = uniqueTag('R');
    const users = await Promise.all([newUser(), newUser(), newUser()]);
    const results = await Promise.allSettled(
      users.map((u, i) => newApplication(i % 2 ? tag.toLowerCase() : tag, u.id)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(getDbViolation(r.reason)?.constraint).toBe(
          DB_CONSTRAINTS.applicationPendingTagUnique,
        );
      }
    }
  });
});

describe('tag format backstop ^[A-Za-z0-9]{2,10}$', () => {
  const bad = ['A', 'AB-C', 'A B', ' AB', 'ÄBC', 'AB_C', 'ab.c'];

  it('rejects malformed team tags and accepts 2..10 alphanumerics', async () => {
    for (const tag of bad) {
      await expectDbError(newTeam(tag), re(DB_CONSTRAINTS.teamTagFormat));
    }
    // 11 chars overflows varchar(10) before the CHECK.
    await expectDbError(newTeam('ABCDEFGHIJK'), /teams_tag_format_chk|too long/);
    const s = uniqueSuffix().replace(/[^a-z0-9]/g, '');
    await newTeam(`z${s}`.slice(0, 2));
    await newTeam(`y${s}`.padEnd(10, '0').slice(0, 10));
  });

  it('rejects malformed application tags and the CHECK also guards updates', async () => {
    for (const tag of bad) {
      await expectDbError(newApplication(tag), re(DB_CONSTRAINTS.applicationTagFormat));
    }
    const ok = await newApplication(uniqueTag('S'));
    await expectDbError(
      prisma.teamApplication.update({ where: { id: ok.id }, data: { requestedTag: 'X' } }),
      re(DB_CONSTRAINTS.applicationTagFormat),
    );
    const v = getDbViolation(
      await prisma.teamApplication
        .update({ where: { id: ok.id }, data: { requestedTag: '--' } })
        .catch((e: unknown) => e),
    );
    expect(v).toMatchObject({ kind: 'check', constraint: DB_CONSTRAINTS.applicationTagFormat });
  });
});

describe('M2 membership / invitation roles (ADR-019)', () => {
  it('memberships accept CAPTAIN/PLAYER/SUBSTITUTE and reject MANAGER/COACH', async () => {
    const team = await newTeam();
    for (const role of ['MANAGER', 'COACH'] as const) {
      const u = await newUser();
      await expectDbError(
        prisma.teamMembership.create({ data: { teamId: team.id, userId: u.id, role } }),
        re(DB_CONSTRAINTS.membershipRoleM2),
      );
    }
    const created = [];
    for (const role of ['CAPTAIN', 'PLAYER', 'SUBSTITUTE'] as const) {
      const u = await newUser();
      created.push(
        await prisma.teamMembership.create({ data: { teamId: team.id, userId: u.id, role } }),
      );
    }
    await expectDbError(
      prisma.teamMembership.update({ where: { id: created[1]!.id }, data: { role: 'COACH' } }),
      re(DB_CONSTRAINTS.membershipRoleM2),
    );
  });

  it('invitations accept PLAYER/SUBSTITUTE and reject CAPTAIN/MANAGER/COACH', async () => {
    const team = await newTeam();
    const captain = await newUser();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    for (const role of ['CAPTAIN', 'MANAGER', 'COACH'] as const) {
      const invitee = await newUser();
      await expectDbError(
        prisma.teamInvitation.create({
          data: {
            teamId: team.id,
            inviteeUserId: invitee.id,
            invitedById: captain.id,
            role,
            expiresAt,
          },
        }),
        re(DB_CONSTRAINTS.invitationRoleM2),
      );
    }
    for (const role of ['PLAYER', 'SUBSTITUTE'] as const) {
      const invitee = await newUser();
      await prisma.teamInvitation.create({
        data: {
          teamId: team.id,
          inviteeUserId: invitee.id,
          invitedById: captain.id,
          role,
          expiresAt,
        },
      });
    }
    // The column default (PLAYER) satisfies the CHECK.
    const invitee = await newUser();
    const inv = await prisma.teamInvitation.create({
      data: { teamId: team.id, inviteeUserId: invitee.id, invitedById: captain.id, expiresAt },
    });
    expect(inv.role).toBe('PLAYER');
  });
});

describe('roster history index', () => {
  it('serves WHERE team_id ORDER BY joined_at DESC, id DESC without a sort', async () => {
    const team = await newTeam();
    const plan = await withPgClient(async (c) => {
      await c.query('BEGIN');
      try {
        // Tiny test tables favour seq/bitmap scans; force the plan shape we rely on at scale.
        await c.query('SET LOCAL enable_seqscan = off');
        await c.query('SET LOCAL enable_bitmapscan = off');
        const r = await c.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT id FROM team_memberships WHERE team_id = $1
            ORDER BY joined_at DESC, id DESC LIMIT 20 OFFSET 0`,
          [team.id],
        );
        return r.rows.map((x) => x['QUERY PLAN']).join('\n');
      } finally {
        await c.query('ROLLBACK');
      }
    });
    expect(plan).toContain('team_memberships_team_id_joined_at_id_idx');
    expect(plan).not.toMatch(/\bSort\b/);
  });
});

describe('idempotency_keys', () => {
  const hash = (ch = 'a') => ch.repeat(64);
  const in24h = () => new Date(Date.now() + 86_400_000);
  const base = (userId: string, key: string = randomUUID()) => ({
    userId,
    key,
    method: 'POST',
    route: '/api/v1/invitations/:id/accept',
    requestHash: hash(),
    expiresAt: in24h(),
  });

  it('enforces one key per user; the same key is fine for another user', async () => {
    const [u1, u2] = [await newUser(), await newUser()];
    const key = randomUUID();
    await prisma.idempotencyKey.create({ data: base(u1.id, key) });
    const err = await expectDbError(
      prisma.idempotencyKey.create({ data: base(u1.id, key) }),
      re(DB_CONSTRAINTS.idempotencyUserKeyUnique),
    );
    expect(err).toContain('P2002');
    await prisma.idempotencyKey.create({ data: base(u2.id, key) });
  });

  it('concurrent reservations of one key: exactly one wins', async () => {
    const u = await newUser();
    const key = randomUUID();
    const results = await Promise.allSettled(
      [0, 1, 2, 3].map(() => prisma.idempotencyKey.create({ data: base(u.id, key) })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(getDbViolation(r.reason)?.constraint).toBe(DB_CONSTRAINTS.idempotencyUserKeyUnique);
      }
    }
  });

  it('validates key format, request hash and method', async () => {
    const u = await newUser();
    // 16 chars (minimum) and 64 chars (maximum) are valid.
    await prisma.idempotencyKey.create({ data: base(u.id, 'min_len-16chars0') });
    await prisma.idempotencyKey.create({ data: base(u.id, 'K'.repeat(64)) });
    for (const key of ['has space 1234567', 'bad*chars1234567', 'ключ1234567890123']) {
      await expectDbError(
        prisma.idempotencyKey.create({ data: base(u.id, key) }),
        re(DB_CONSTRAINTS.idempotencyKeyFormat),
      );
    }
    await expectDbError(
      prisma.idempotencyKey.create({ data: base(u.id, '123456789012345') }),
      re(DB_CONSTRAINTS.idempotencyKeyFormat),
    );
    await expectDbError(
      prisma.idempotencyKey.create({ data: base(u.id, 'k'.repeat(65)) }),
      /idempotency_keys_key_format_chk|too long/,
    );
    for (const requestHash of [hash('A'), hash('g'), 'abc', ' '.repeat(64)]) {
      await expectDbError(
        prisma.idempotencyKey.create({ data: { ...base(u.id), requestHash } }),
        re(DB_CONSTRAINTS.idempotencyRequestHashFormat),
      );
    }
    for (const method of ['GET', 'post', 'HEAD']) {
      await expectDbError(
        prisma.idempotencyKey.create({ data: { ...base(u.id), method } }),
        re(DB_CONSTRAINTS.idempotencyMethod),
      );
    }
    await expectDbError(
      prisma.idempotencyKey.create({ data: { ...base(u.id), route: '   ' } }),
      /idempotency_keys_route_not_blank_chk/,
    );
  });

  it('enforces response consistency per status and expiry after creation', async () => {
    const u = await newUser();
    await expectDbError(
      prisma.idempotencyKey.create({ data: { ...base(u.id), status: 'COMPLETED' } }),
      re(DB_CONSTRAINTS.idempotencyCompletedResponse),
    );
    await expectDbError(
      prisma.idempotencyKey.create({ data: { ...base(u.id), responseStatus: 201 } }),
      re(DB_CONSTRAINTS.idempotencyInProgressEmpty),
    );
    await expectDbError(
      prisma.idempotencyKey.create({ data: { ...base(u.id), responseBody: { id: 'x' } } }),
      re(DB_CONSTRAINTS.idempotencyInProgressEmpty),
    );
    await expectDbError(
      prisma.idempotencyKey.create({
        data: { ...base(u.id), status: 'COMPLETED', responseStatus: 409 },
      }),
      re(DB_CONSTRAINTS.idempotencyResponseStatus2xx),
    );
    const now = new Date();
    await expectDbError(
      prisma.idempotencyKey.create({ data: { ...base(u.id), createdAt: now, expiresAt: now } }),
      re(DB_CONSTRAINTS.idempotencyExpiry),
    );
  });

  it('supports the API lifecycle: reserve → complete → overwrite after expiry → delete', async () => {
    const u = await newUser();
    const key = randomUUID();
    const row = await prisma.idempotencyKey.create({ data: base(u.id, key) });
    expect(row.status).toBe('IN_PROGRESS');
    const done = await prisma.idempotencyKey.update({
      where: { id: row.id },
      data: { status: 'COMPLETED', responseStatus: 201, responseBody: { id: 'inv-1' } },
    });
    expect(done.responseBody).toEqual({ id: 'inv-1' });
    // 204 responses have no body.
    await prisma.idempotencyKey.create({
      data: { ...base(u.id), status: 'COMPLETED', responseStatus: 204 },
    });
    // Expired row is re-used in place for a new request (lookup by the unique key).
    const now = new Date();
    const reused = await prisma.idempotencyKey.update({
      where: { userId_key: { userId: u.id, key } },
      data: {
        status: 'IN_PROGRESS',
        responseStatus: null,
        responseBody: Prisma.DbNull,
        requestHash: hash('b'),
        createdAt: now,
        expiresAt: new Date(now.getTime() + 86_400_000),
      },
    });
    expect(reused.status).toBe('IN_PROGRESS');
    await prisma.idempotencyKey.delete({ where: { id: row.id } });
  });
});

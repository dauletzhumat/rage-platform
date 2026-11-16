import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StubSteamProvider, testSteamId } from '../support/steam-stub.js';
import { createAuthTestApp, type LoggedIn, login, WEB } from './auth-helpers.js';
import { prismaOf, sampleSteamId, truncateAll } from './helpers.js';

type Who = LoggedIn & { id: string; steamId64: string };
interface Team {
  id: string;
  slug: string;
  captain: Who;
  /** Active members incl. the captain, captain first. */
  members: string[];
}
interface Tournament {
  id: string;
  slug: string;
}

const POOL = ['de_alpha', 'de_bravo', 'de_charlie', 'de_delta', 'de_echo', 'de_foxtrot', 'de_golf'];

/**
 * M3 tournaments, registrations, roster snapshots, bans, brackets, veto and admin results against
 * real PostgreSQL + Redis (docs/TOURNAMENTS.md). Includes every mandatory concurrency case (§14).
 */
describe('M3 tournaments API (real PostgreSQL + Redis)', () => {
  let app: NestExpressApplication;
  let op: StubSteamProvider;
  const adminSteamId = testSteamId();
  let admin: Who;
  let seq = 0;

  const db = () => prismaOf(app);
  const server = () => app.getHttpServer();
  const uniq = () => `${Date.now().toString(36).slice(-4)}${(seq += 1)}`;
  let tagSeq = 0;
  const newTag = () => `M${(tagSeq++).toString(36).toUpperCase().padStart(4, '0')}`;

  function send(
    method: 'post' | 'put' | 'patch',
    path: string,
    who: LoggedIn | null,
    body?: object,
    headers: Record<string, string> = {},
  ) {
    let req = request(server())[method](`/api/v1${path}`).set('Origin', WEB);
    if (who) req = req.set('Cookie', who.cookie).set('x-csrf-token', who.csrf);
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return body === undefined ? req : req.send(body);
  }
  const post = (p: string, w: LoggedIn | null, b?: object, h?: Record<string, string>) =>
    send('post', p, w, b, h);
  const put = (p: string, w: LoggedIn | null, b?: object) => send('put', p, w, b);
  const patch = (p: string, w: LoggedIn | null, b?: object) => send('patch', p, w, b);
  function get(path: string, who?: LoggedIn | null) {
    const req = request(server()).get(`/api/v1${path}`);
    return who ? req.set('Cookie', who.cookie) : req;
  }

  async function user(steamId64 = testSteamId()): Promise<Who> {
    const session = await login(app, op, steamId64);
    const row = await db().user.findUniqueOrThrow({ where: { steamId64 } });
    return { ...session, id: row.id, steamId64 };
  }

  /** A registered (signed-in-once) player created directly; does not act in the test. */
  async function dbUser(
    opts: { status?: 'ACTIVE' | 'SUSPENDED'; sample?: boolean; nickname?: string } = {},
  ) {
    const u = uniq();
    const row = await db().user.create({
      data: {
        steamId64: opts.sample ? sampleSteamId() : testSteamId(),
        status: opts.status ?? 'ACTIVE',
        isSample: opts.sample ?? false,
        playerProfile: { create: { nickname: opts.nickname ?? `p${u}`, slug: `player-m3-${u}` } },
      },
    });
    return { id: row.id, steamId64: row.steamId64 };
  }

  /** Team with an API-capable captain plus `extra` players (memberships created directly). */
  async function mkTeam(extra = 6, captain?: Who): Promise<Team> {
    const cap = captain ?? (await user());
    const u = uniq();
    const team = await db().team.create({
      data: { slug: `m3-team-${u}`, name: `M3 Team ${u}`, tag: newTag(), status: 'ACTIVE' },
    });
    await db().teamMembership.create({
      data: { teamId: team.id, userId: cap.id, role: 'CAPTAIN' },
    });
    const members = [cap.id];
    for (let i = 0; i < extra; i++) {
      const p = await dbUser();
      await db().teamMembership.create({
        data: { teamId: team.id, userId: p.id, role: 'PLAYER' },
      });
      members.push(p.id);
    }
    return { id: team.id, slug: team.slug, captain: cap, members };
  }

  async function mkTournament(
    overrides: Record<string, unknown> = {},
    open = true,
  ): Promise<Tournament> {
    const res = await post('/admin/tournaments', admin, {
      name: `Cup ${uniq()}`,
      format: 'SINGLE_ELIMINATION',
      defaultMatchFormat: 'BO1',
      maxTeams: 16,
      mapPool: POOL,
      ...overrides,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    if (open) {
      await post(`/admin/tournaments/${res.body.id}/status`, admin, {
        to: 'REGISTRATION_OPEN',
      }).expect(200);
    }
    return { id: res.body.id as string, slug: res.body.slug as string };
  }

  function register(t: Tournament, team: Team, starters?: string[], subs: string[] = []) {
    return post(`/tournaments/${t.id}/registrations`, team.captain, {
      teamId: team.id,
      starters: starters ?? team.members.slice(0, 5),
      substitutes: subs,
    });
  }

  async function registerOk(t: Tournament, team: Team, starters?: string[], subs?: string[]) {
    const res = await register(t, team, starters, subs);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; roster: { id: string; version: number } };
  }

  async function approveOk(t: Tournament, registrationId: string) {
    const res = await post(
      `/admin/tournaments/${t.id}/registrations/${registrationId}/approve`,
      admin,
      {},
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  }

  const setStatus = (t: Tournament, to: string, reason?: string) =>
    post(`/admin/tournaments/${t.id}/status`, admin, reason ? { to, reason } : { to });

  /** n approved teams (seed i+1 = i-th team), closed and bracket generated. */
  async function setupBracket(n: number, overrides: Record<string, unknown> = {}) {
    const t = await mkTournament(overrides);
    const teams: Team[] = [];
    for (let i = 0; i < n; i++) {
      const team = await mkTeam(5);
      const reg = await registerOk(t, team);
      await approveOk(t, reg.id);
      teams.push(team);
    }
    await setStatus(t, 'REGISTRATION_CLOSED').expect(200);
    const res = await post(`/admin/tournaments/${t.id}/generate-bracket`, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { t, teams, bracket: res.body as Bracket };
  }

  interface BracketMatch {
    id: string;
    status: string;
    slotNumber: number;
    isBye: boolean;
    statusReason: string | null;
    teamA: { id: string } | null;
    teamB: { id: string } | null;
    teamASeed: number | null;
    teamBSeed: number | null;
    format: string;
    nextMatchId: string | null;
    winnerTeamId: string | null;
  }
  interface Bracket {
    size: number;
    rounds: Array<{ roundNumber: number; name: string; matches: BracketMatch[] }>;
  }
  const matchAt = (b: Bracket, round: number, slot: number) =>
    b.rounds.find((r) => r.roundNumber === round)!.matches.find((m) => m.slotNumber === slot)!;

  async function auditCount(action: string, resourceId?: string) {
    return db().auditLog.count({ where: { action, ...(resourceId ? { resourceId } : {}) } });
  }

  /** Revokes the user's TEAM_MANAGER grants directly (keeps later conflict checks clean). */
  async function revokeTeamManagerGrants(userId: string) {
    await db().userRoleGrant.updateMany({
      where: { userId, role: 'TEAM_MANAGER', revokedAt: null },
      data: { revokedAt: new Date(), revokedById: admin.id },
    });
  }

  async function grant(target: Who, role: string, scopeType: string, scopeId?: string) {
    await post(`/admin/users/${target.id}/roles`, admin, {
      role,
      scopeType,
      ...(scopeId ? { scopeId } : {}),
      reason: 'm3 test grant',
    }).expect(201);
  }

  beforeAll(async () => {
    ({ app, op } = await createAuthTestApp({ BOOTSTRAP_SUPER_ADMIN_STEAM_ID64: adminSteamId }));
    await app.listen(0, '127.0.0.1');
    await truncateAll(app);
    admin = await user(adminSteamId);
  });
  afterAll(async () => {
    if (app) {
      await truncateAll(app);
      await app.close();
    }
  });

  // -------------------------------------------------------------------------------------------
  describe('wiring: session, CSRF, roles', () => {
    it('anonymous → 401, missing CSRF → 403, non-admin → 403 on new unsafe endpoints', async () => {
      const id = randomUUID();
      for (const path of [
        '/admin/tournaments',
        `/admin/tournaments/${id}/status`,
        `/admin/tournaments/${id}/generate-bracket`,
        `/tournaments/${id}/registrations`,
        `/matches/${id}/veto`,
        `/admin/matches/${id}/result-override`,
        '/admin/banned-steam-ids',
      ]) {
        const anon = await post(path, null, {}).expect(401);
        expect(anon.body.code).toBe('UNAUTHENTICATED');
      }
      const someone = await user();
      const noCsrf = await request(server())
        .post('/api/v1/admin/tournaments')
        .set('Cookie', someone.cookie)
        .set('Origin', WEB)
        .send({})
        .expect(403);
      expect(noCsrf.body.code).toBe('CSRF_FAILED');
      const create = await post('/admin/tournaments', someone, {
        name: 'Nope Cup',
        format: 'SINGLE_ELIMINATION',
        defaultMatchFormat: 'BO1',
        maxTeams: 8,
        mapPool: POOL,
      }).expect(403);
      expect(create.body.code).toBe('FORBIDDEN_ROLE');
      expect((await get('/admin/tournaments', someone).expect(403)).body.code).toBe(
        'FORBIDDEN_ROLE',
      );
      expect((await get('/admin/banned-steam-ids', someone).expect(403)).body.code).toBe(
        'FORBIDDEN_ROLE',
      );
      expect((await get('/admin/matches', someone).expect(403)).body.code).toBe('FORBIDDEN_ROLE');
      expect(await db().tournament.count({ where: { name: 'Nope Cup' } })).toBe(0);
      // Demo mode is off by default (ALLOW_SAMPLE_MUTATIONS unset).
      const meta = await get('/meta').expect(200);
      expect(meta.body.features.sampleMutations).toEqual({ status: 'disabled' });
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('tournament admin', () => {
    it('create validation: pool of exactly 7 valid distinct maps, name rules, window', async () => {
      const base = {
        name: `Valid ${uniq()}`,
        format: 'SINGLE_ELIMINATION',
        defaultMatchFormat: 'BO1',
        maxTeams: 8,
        mapPool: POOL,
      };
      for (const body of [
        { ...base, mapPool: POOL.slice(0, 6) },
        { ...base, mapPool: [...POOL.slice(0, 6), 'de_alpha'] },
        { ...base, mapPool: [...POOL.slice(0, 6), 'Mirage'] },
        { ...base, mapPool: undefined },
        { ...base, name: 'ab' },
        { ...base, name: '-bad' },
        { ...base, maxTeams: 65 },
        { ...base, maxTeams: 1 },
        { ...base, defaultMatchFormat: 'BO2' },
        { ...base, slug: 'client-slug' },
        {
          ...base,
          registrationOpenAt: '2026-12-02T00:00:00.000Z',
          registrationCloseAt: '2026-12-01T00:00:00.000Z',
        },
      ]) {
        const res = await post('/admin/tournaments', admin, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      }
      const fmt = await post('/admin/tournaments', admin, {
        ...base,
        format: 'DOUBLE_ELIMINATION',
      }).expect(409);
      expect(fmt.body.code).toBe('FORMAT_NOT_SUPPORTED');
    });

    it('create: DRAFT, server slug (reserved suffixed), unique name case-insensitive, audited', async () => {
      const res = await post('/admin/tournaments', admin, {
        name: 'Register',
        format: 'SINGLE_ELIMINATION',
        defaultMatchFormat: 'BO3',
        finalMatchFormat: 'BO5',
        maxTeams: 8,
        mapPool: POOL,
        description: 'Line one\nLine two',
      }).expect(201);
      expect(res.body).toMatchObject({
        name: 'Register',
        slug: 'register-2',
        status: 'DRAFT',
        defaultMatchFormat: 'BO3',
        finalMatchFormat: 'BO5',
        maxTeams: 8,
        mapPool: POOL,
        description: 'Line one\nLine two',
        approvedTeamCount: 0,
        bracketGenerated: false,
        isSample: false,
      });
      expect(await auditCount('tournament.create', res.body.id)).toBe(1);
      const dup = await post('/admin/tournaments', admin, {
        name: 'REGISTER',
        format: 'SINGLE_ELIMINATION',
        defaultMatchFormat: 'BO1',
        maxTeams: 8,
        mapPool: POOL,
      }).expect(409);
      expect(dup.body.code).toBe('TOURNAMENT_NAME_TAKEN');
    });

    it('DRAFT is hidden publicly; admin read works; scoped admins see only theirs', async () => {
      const t = await mkTournament({}, false);
      expect(
        (await get('/tournaments').expect(200)).body.items.map((x: Tournament) => x.slug),
      ).not.toContain(t.slug);
      await get(`/tournaments/${t.slug}`).expect(404);
      await get(`/tournaments/${t.slug}/teams`).expect(404);
      await get(`/tournaments/${t.slug}/bracket`).expect(404);
      const adminView = await get(`/admin/tournaments/${t.id}`, admin).expect(200);
      expect(adminView.body.status).toBe('DRAFT');
      const list = await get('/admin/tournaments?status=DRAFT&pageSize=100', admin).expect(200);
      expect(list.body.items.map((x: Tournament) => x.id)).toContain(t.id);

      const outsider = await user();
      await get(`/admin/tournaments/${t.id}`, outsider).expect(404);
      const scoped = await user();
      await grant(scoped, 'TOURNAMENT_ADMIN', 'TOURNAMENT', t.id);
      await get(`/admin/tournaments/${t.id}`, scoped).expect(200);
      const scopedList = await get('/admin/tournaments?pageSize=100', scoped).expect(200);
      expect(scopedList.body.items.map((x: Tournament) => x.id)).toEqual([t.id]);
      const me = await get('/me', scoped).expect(200);
      expect(me.body.roles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'TOURNAMENT_ADMIN', scopeId: t.id, scopeSlug: t.slug }),
        ]),
      );
      // A scoped admin can edit its tournament but cannot create (global only).
      await patch(`/admin/tournaments/${t.id}`, scoped, { maxTeams: 4 }).expect(200);
      const create = await post('/admin/tournaments', scoped, {
        name: `Scoped ${uniq()}`,
        format: 'SINGLE_ELIMINATION',
        defaultMatchFormat: 'BO1',
        maxTeams: 4,
        mapPool: POOL,
      }).expect(403);
      expect(create.body.code).toBe('FORBIDDEN_ROLE');

      await setStatus(t, 'REGISTRATION_OPEN').expect(200);
      const pub = await get(`/tournaments/${t.slug}`).expect(200);
      expect(pub.body).toMatchObject({
        status: 'REGISTRATION_OPEN',
        mapPool: POOL,
        defaultMatchFormat: 'BO1',
        finalMatchFormat: null,
        maxTeams: 4,
        approvedTeamCount: 0,
        registeredTeamCount: 0,
        registrationOpen: true,
      });
      // Published now: an outsider gets 403 instead of 404.
      expect((await get(`/admin/tournaments/${t.id}`, outsider).expect(403)).body.code).toBe(
        'FORBIDDEN_ROLE',
      );
      const bracket = await get(`/tournaments/${t.slug}/bracket`).expect(200);
      expect(bracket.body).toEqual({ format: 'SINGLE_ELIMINATION', size: 0, rounds: [] });
      expect((await get(`/tournaments/${t.slug}/teams`).expect(200)).body).toEqual([]);
    });

    it('status transition matrix, edit window, cancel requires a reason; all audited', async () => {
      const t = await mkTournament({}, false);
      const bad = async (to: string) => {
        const r = await setStatus(t, to).expect(409);
        expect(r.body.code).toBe('INVALID_STATE_TRANSITION');
      };
      await bad('REGISTRATION_CLOSED');
      await bad('IN_PROGRESS');
      await bad('COMPLETED');
      await bad('DRAFT');
      await setStatus(t, 'REGISTRATION_OPEN').expect(200);
      await bad('REGISTRATION_OPEN');
      await bad('IN_PROGRESS');
      await bad('DRAFT');
      await patch(`/admin/tournaments/${t.id}`, admin, { maxTeams: 12 }).expect(200);
      await setStatus(t, 'REGISTRATION_CLOSED').expect(200);
      await bad('REGISTRATION_OPEN');
      await bad('IN_PROGRESS'); // only generate-bracket
      const edit = await patch(`/admin/tournaments/${t.id}`, admin, { maxTeams: 4 }).expect(409);
      expect(edit.body.code).toBe('INVALID_STATE_TRANSITION');
      const noReason = await setStatus(t, 'CANCELLED').expect(400);
      expect(noReason.body.details[0].field).toBe('reason');
      await setStatus(t, 'CANCELLED', 'organiser withdrew').expect(200);
      await bad('REGISTRATION_OPEN');
      expect(await auditCount('tournament.status_change', t.id)).toBe(3);
      expect(await auditCount('tournament.update', t.id)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('registrations and roster snapshots', () => {
    it('register: PENDING + roster v1 DRAFT snapshot; shape errors; duplicates; operator only', async () => {
      const t = await mkTournament();
      const team = await mkTeam(6);
      const shapeBad = [
        [team.members.slice(0, 4), []],
        [[...team.members.slice(0, 4), team.members[0]!], []],
        [team.members.slice(0, 5), [team.members[0]!]],
        [team.members.slice(0, 5), team.members.slice(5, 7).concat(randomUUID())],
      ] as const;
      for (const [starters, subs] of shapeBad) {
        const r = await register(t, team, [...starters], [...subs]).expect(400);
        expect(r.body.code).toBe('ROSTER_INVALID');
        expect(r.body.details.length).toBeGreaterThan(0);
      }
      const stranger = await user();
      const forbidden = await post(`/tournaments/${t.id}/registrations`, stranger, {
        teamId: team.id,
        starters: team.members.slice(0, 5),
        substitutes: [],
      }).expect(403);
      expect(forbidden.body.code).toBe('FORBIDDEN_ROLE');

      const reg = await register(
        t,
        team,
        team.members.slice(0, 5),
        team.members.slice(5, 7),
      ).expect(201);
      expect(reg.body).toMatchObject({
        status: 'PENDING',
        seed: null,
        tournament: { id: t.id, slug: t.slug },
        team: { id: team.id, slug: team.slug },
        roster: { version: 1, status: 'DRAFT', lockedAt: null },
      });
      expect(reg.body.roster.entries).toHaveLength(7);
      expect(
        reg.body.roster.entries.filter((e: { role: string }) => e.role === 'STARTER'),
      ).toHaveLength(5);
      expect(reg.body.roster.entries[0].steamId64).toMatch(/^\d{17}$/);
      expect(await auditCount('registration.submit', reg.body.id)).toBe(1);

      const again = await register(t, team).expect(409);
      expect(again.body.code).toBe('ALREADY_REGISTERED');

      const mine = await get('/me/registrations', team.captain).expect(200);
      expect(mine.body.map((r: { id: string }) => r.id)).toContain(reg.body.id);
      expect((await get('/me/registrations', stranger).expect(200)).body).toEqual([]);

      // Roster update: v2 DRAFT, v1 SUPERSEDED, entries of v1 untouched.
      const upd = await put(
        `/tournaments/${t.id}/registrations/${reg.body.id}/roster`,
        team.captain,
        { teamId: team.id, starters: team.members.slice(2, 7), substitutes: [] },
      ).expect(200);
      expect(upd.body.roster).toMatchObject({ version: 2, status: 'DRAFT' });
      const v1 = await db().tournamentRoster.findUniqueOrThrow({
        where: { id: reg.body.roster.id },
        include: { entries: true },
      });
      expect(v1.status).toBe('SUPERSEDED');
      expect(v1.entries).toHaveLength(7);
      expect(await auditCount('registration.roster_update', reg.body.id)).toBe(1);

      // Withdraw: WITHDRAWN; a second withdraw → REGISTRATION_NOT_PENDING.
      await post(`/tournaments/${t.id}/registrations/${reg.body.id}/withdraw`, team.captain).expect(
        200,
      );
      const twice = await post(
        `/tournaments/${t.id}/registrations/${reg.body.id}/withdraw`,
        team.captain,
      ).expect(409);
      expect(twice.body.code).toBe('REGISTRATION_NOT_PENDING');
      expect(await auditCount('registration.withdraw', reg.body.id)).toBe(1);
    });

    it('registration closed / DRAFT hidden / outside the window', async () => {
      const draft = await mkTournament({}, false);
      const team = await mkTeam(5);
      await register(draft, team).expect(404);
      const future = await mkTournament({
        registrationOpenAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect((await register(future, team).expect(409)).body.code).toBe('REGISTRATION_CLOSED');
      const closed = await mkTournament();
      await setStatus(closed, 'REGISTRATION_CLOSED').expect(200);
      expect((await register(closed, team).expect(409)).body.code).toBe('REGISTRATION_CLOSED');
    });

    it('eligibility reasons: NOT_TEAM_MEMBER, USER_INACTIVE, SAMPLE, BANNED, ALREADY_REGISTERED_ELSEWHERE', async () => {
      const t = await mkTournament();
      const team = await mkTeam(4);
      const outsider = await dbUser();
      const suspended = await dbUser({ status: 'SUSPENDED' });
      const sample = await dbUser({ sample: true });
      const banned = await dbUser();
      for (const p of [suspended, sample, banned]) {
        await db().teamMembership.create({
          data: { teamId: team.id, userId: p.id, role: 'PLAYER' },
        });
      }
      await post('/admin/banned-steam-ids', admin, {
        steamId64: banned.steamId64,
        reason: 'cheating',
      }).expect(201);
      const res = await register(
        t,
        team,
        [team.members[0]!, outsider.id, suspended.id, sample.id, banned.id],
        [],
      ).expect(409);
      expect(res.body.code).toBe('PLAYER_INELIGIBLE');
      expect(res.body.details).toEqual([
        { field: outsider.id, message: 'NOT_TEAM_MEMBER' },
        { field: suspended.id, message: 'USER_INACTIVE' },
        { field: sample.id, message: 'SAMPLE' },
        { field: banned.id, message: 'BANNED' },
      ]);
      expect(await db().tournamentRegistration.count({ where: { tournamentId: t.id } })).toBe(0);

      // ALREADY_REGISTERED_ELSEWHERE: P on team X's PENDING roster moves to team Y.
      const x = await mkTeam(5);
      const y = await mkTeam(5);
      const p = x.members[1]!;
      await registerOk(t, x);
      await db().teamMembership.updateMany({
        where: { teamId: x.id, userId: p, leftAt: null },
        data: { leftAt: new Date(), leftReason: 'left' },
      });
      await db().teamMembership.create({ data: { teamId: y.id, userId: p, role: 'PLAYER' } });
      const elsewhere = await register(t, y, [...y.members.slice(0, 4), p]).expect(409);
      expect(elsewhere.body.details).toEqual([
        { field: p, message: 'ALREADY_REGISTERED_ELSEWHERE' },
      ]);
    });

    it('approve re-validates (ban after submit), locks roster; reject reason visible; snapshot survives (A5)', async () => {
      const t = await mkTournament();
      const a = await mkTeam(6, undefined);
      const b = await mkTeam(5);
      const regA = await registerOk(t, a, a.members.slice(0, 5), a.members.slice(5, 6));
      const regB = await registerOk(t, b);

      // Ban a starter of B after submission → approval refused with details.
      const bannedId = b.members[2]!;
      const bannedUser = await db().user.findUniqueOrThrow({ where: { id: bannedId } });
      await post('/admin/banned-steam-ids', admin, {
        steamId64: bannedUser.steamId64,
        reason: 'ban after submit',
      }).expect(201);
      const refused = await post(
        `/admin/tournaments/${t.id}/registrations/${regB.id}/approve`,
        admin,
        {},
      ).expect(409);
      expect(refused.body).toMatchObject({
        code: 'PLAYER_INELIGIBLE',
        details: [{ field: bannedId, message: 'BANNED' }],
      });
      const rej = await post(`/admin/tournaments/${t.id}/registrations/${regB.id}/reject`, admin, {
        reason: 'banned player on roster',
      }).expect(200);
      expect(rej.body).toMatchObject({
        status: 'REJECTED',
        reviewReason: 'banned player on roster',
      });
      const mineB = await get('/me/registrations', b.captain).expect(200);
      expect(mineB.body[0]).toMatchObject({ id: regB.id, reviewReason: 'banned player on roster' });
      expect(await auditCount('registration.reject', regB.id)).toBe(1);

      const approved = await approveOk(t, regA.id);
      expect(approved).toMatchObject({ status: 'APPROVED', isSample: false });
      expect(approved.roster).toMatchObject({ version: 1, status: 'LOCKED' });
      expect(approved.roster.lockedAt).not.toBeNull();
      expect(await auditCount('registration.approve', regA.id)).toBe(1);
      const again = await post(
        `/admin/tournaments/${t.id}/registrations/${regA.id}/approve`,
        admin,
        {},
      ).expect(409);
      expect(again.body.code).toBe('REGISTRATION_NOT_PENDING');

      // Snapshot survives later team roster and nickname changes (A5).
      const before = (await get(`/tournaments/${t.slug}/teams`).expect(200)).body;
      expect(before).toHaveLength(1);
      expect(before[0].roster.entries).toHaveLength(6);
      expect(JSON.stringify(before)).not.toMatch(/\d{17}/); // no SteamIDs publicly
      const removed = a.members[1]!;
      await db().teamMembership.updateMany({
        where: { teamId: a.id, userId: removed, leftAt: null },
        data: { leftAt: new Date(), leftReason: 'removed' },
      });
      await db().playerProfile.update({
        where: { userId: a.members[2]! },
        data: { nickname: 'renamed-later' },
      });
      const after = (await get(`/tournaments/${t.slug}/teams`).expect(200)).body;
      expect(after).toEqual(before);
      // The DB refuses to rewrite a locked snapshot.
      await expect(
        db().tournamentRosterEntry.updateMany({
          where: { rosterId: approved.roster.id },
          data: { nicknameSnapshot: 'hacked' },
        }),
      ).rejects.toThrow();
    });

    it('withdraw is refused once the tournament is IN_PROGRESS', async () => {
      const { t, teams } = await setupBracket(2);
      const reg = await db().tournamentRegistration.findFirstOrThrow({
        where: { tournamentId: t.id, teamId: teams[0]!.id },
      });
      const res = await post(
        `/tournaments/${t.id}/registrations/${reg.id}/withdraw`,
        teams[0]!.captain,
      ).expect(409);
      expect(res.body.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('concurrency: approvals at maxTeams never exceed the limit', async () => {
      const t = await mkTournament({ maxTeams: 2 });
      const regs = [];
      for (let i = 0; i < 4; i++) regs.push(await registerOk(t, await mkTeam(5)));
      const results = await Promise.all(
        regs.map((r) =>
          post(`/admin/tournaments/${t.id}/registrations/${r.id}/approve`, admin, {}),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.code).toBe('TOURNAMENT_FULL');
      }
      expect(
        await db().tournamentRegistration.count({
          where: { tournamentId: t.id, status: 'APPROVED' },
        }),
      ).toBe(2);
      expect(
        await db().tournamentRoster.count({
          where: { registration: { tournamentId: t.id }, status: 'LOCKED' },
        }),
      ).toBe(2);
    });

    it('concurrency: the same player registered by two teams ⇒ on exactly one roster', async () => {
      const t = await mkTournament();
      for (let round = 0; round < 3; round++) {
        const x = await mkTeam(5);
        const y = await mkTeam(4);
        const p = await user();
        await db().teamMembership.create({ data: { teamId: x.id, userId: p.id, role: 'PLAYER' } });
        const inv = await post(`/teams/${y.id}/invitations`, y.captain, {
          steamId64: p.steamId64,
          role: 'PLAYER',
        }).expect(201);
        const [rx, ry] = await Promise.all([
          register(t, x, [...x.members.slice(0, 4), p.id]),
          (async () => {
            await post(`/teams/${x.id}/leave`, p).expect(204);
            await post(`/invitations/${inv.body.id}/accept`, p).expect(200);
            return register(t, y, [...y.members.slice(0, 4), p.id]);
          })(),
        ]);
        const statuses = [rx.status, ry.status].sort();
        expect(statuses).toEqual([201, 409]);
        const loser = rx.status === 409 ? rx : ry;
        expect(loser.body.code).toBe('PLAYER_INELIGIBLE');
        expect(['NOT_TEAM_MEMBER', 'ALREADY_REGISTERED_ELSEWHERE']).toContain(
          loser.body.details[0].message,
        );
        const onRosters = await db().tournamentRosterEntry.count({
          where: {
            userId: p.id,
            roster: {
              status: { in: ['DRAFT', 'LOCKED'] },
              registration: { tournamentId: t.id, status: { in: ['PENDING', 'APPROVED'] } },
            },
          },
        });
        expect(onRosters).toBe(1);
      }
    });

    it('substitution after lock: new LOCKED version; eligibility; not after first completed match', async () => {
      const { t, teams, bracket } = await setupBracket(2);
      const team = teams[0]!;
      const bench = await dbUser();
      await db().teamMembership.create({
        data: { teamId: team.id, userId: bench.id, role: 'PLAYER' },
      });
      const reg = await db().tournamentRegistration.findFirstOrThrow({
        where: { tournamentId: t.id, teamId: team.id },
      });
      const path = `/admin/tournaments/${t.id}/registrations/${reg.id}/substitute`;
      const outsider = await dbUser();
      const notMember = await post(path, admin, {
        outUserId: team.members[1],
        inUserId: outsider.id,
        role: 'STARTER',
        reason: 'injury',
      }).expect(409);
      expect(notMember.body.details).toEqual([{ field: outsider.id, message: 'NOT_TEAM_MEMBER' }]);
      const notOnRoster = await post(path, admin, {
        outUserId: bench.id,
        inUserId: team.members[1],
        role: 'STARTER',
        reason: 'injury',
      }).expect(400);
      expect(notOnRoster.body.code).toBe('ROSTER_INVALID');
      const wrongRole = await post(path, admin, {
        outUserId: team.members[1],
        inUserId: bench.id,
        role: 'SUBSTITUTE',
        reason: 'injury',
      }).expect(400);
      expect(wrongRole.body.code).toBe('ROSTER_INVALID');
      const ok = await post(path, admin, {
        outUserId: team.members[1],
        inUserId: bench.id,
        role: 'STARTER',
        reason: 'injury',
      }).expect(200);
      expect(ok.body.roster).toMatchObject({ version: 2, status: 'LOCKED' });
      const ids = ok.body.roster.entries.map((e: { userId: string }) => e.userId);
      expect(ids).toContain(bench.id);
      expect(ids).not.toContain(team.members[1]);
      const v2 = await db().tournamentRoster.findFirstOrThrow({
        where: { registrationId: reg.id, version: 2 },
      });
      expect(v2.changeReason).toBe('injury');
      expect(
        (
          await db().tournamentRoster.findFirstOrThrow({
            where: { registrationId: reg.id, version: 1 },
          })
        ).status,
      ).toBe('SUPERSEDED');
      expect(await auditCount('registration.substitute', reg.id)).toBe(1);

      // After the team's first completed match: not allowed.
      const final = matchAt(bracket, 1, 1);
      await post(`/admin/matches/${final.id}/forfeit`, admin, {
        forfeitingTeamId: teams[1]!.id,
        reason: 'no show',
      }).expect(200);
      const late = await post(path, admin, {
        outUserId: bench.id,
        inUserId: team.members[1],
        role: 'STARTER',
        reason: 'back',
      }).expect(409);
      expect(late.body.code).toBe('SUBSTITUTION_NOT_ALLOWED');
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('bans', () => {
    it('SUPER_ADMIN only; duplicates refused; lift; list', async () => {
      const ta = await user();
      await grant(ta, 'TOURNAMENT_ADMIN', 'GLOBAL');
      const steamId64 = testSteamId();
      expect(
        (await post('/admin/banned-steam-ids', ta, { steamId64, reason: 'x y z' }).expect(403)).body
          .code,
      ).toBe('FORBIDDEN_ROLE');
      const ban = await post('/admin/banned-steam-ids', admin, {
        steamId64,
        reason: 'smurfing',
      }).expect(201);
      expect(ban.body).toMatchObject({
        steamId64,
        reason: 'smurfing',
        active: true,
        liftedAt: null,
        createdBy: { id: admin.id },
      });
      const dup = await post('/admin/banned-steam-ids', admin, {
        steamId64,
        reason: 'again',
      }).expect(409);
      expect(dup.body.code).toBe('STEAM_ID_ALREADY_BANNED');
      await post('/admin/banned-steam-ids', admin, { steamId64: '123', reason: 'bad id' }).expect(
        400,
      );
      const lifted = await post(`/admin/banned-steam-ids/${ban.body.id}/lift`, admin, {
        reason: 'appeal accepted',
      }).expect(200);
      expect(lifted.body).toMatchObject({ active: false, liftReason: 'appeal accepted' });
      expect(
        (
          await post(`/admin/banned-steam-ids/${ban.body.id}/lift`, admin, {
            reason: 'again',
          }).expect(409)
        ).body.code,
      ).toBe('INVALID_STATE_TRANSITION');
      // A new ban for the same SteamID is possible once lifted.
      await post('/admin/banned-steam-ids', admin, { steamId64, reason: 'relapse' }).expect(201);
      const list = await get('/admin/banned-steam-ids?active=true&pageSize=100', admin).expect(200);
      expect(
        list.body.items.filter((b: { steamId64: string }) => b.steamId64 === steamId64),
      ).toHaveLength(1);
      expect(await auditCount('steam_ban.create')).toBeGreaterThanOrEqual(2);
      expect(await auditCount('steam_ban.lift', ban.body.id)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('seeding and bracket generation', () => {
    it('seeds: only while closed, must cover all APPROVED 1..N; generation honours them', async () => {
      const t = await mkTournament();
      const teams = [await mkTeam(5), await mkTeam(5), await mkTeam(5)];
      const regs = [];
      for (const team of teams) {
        const r = await registerOk(t, team);
        await approveOk(t, r.id);
        regs.push(r.id);
      }
      const early = await put(`/admin/tournaments/${t.id}/seeds`, admin, {
        seeds: regs.map((id, i) => ({ registrationId: id, seed: i + 1 })),
      }).expect(409);
      expect(early.body.code).toBe('INVALID_STATE_TRANSITION');
      await setStatus(t, 'REGISTRATION_CLOSED').expect(200);
      for (const seeds of [
        [{ registrationId: regs[0], seed: 1 }],
        regs.map((id) => ({ registrationId: id, seed: 1 })),
        regs.map((id, i) => ({ registrationId: id, seed: i + 2 })),
      ]) {
        const r = await put(`/admin/tournaments/${t.id}/seeds`, admin, { seeds }).expect(400);
        expect(r.body.code).toBe('SEEDS_INVALID');
      }
      // Reverse order, then re-seed (clear-then-set in one transaction).
      await put(`/admin/tournaments/${t.id}/seeds`, admin, {
        seeds: regs.map((id, i) => ({ registrationId: id, seed: 3 - i })),
      }).expect(200);
      const reseed = await put(`/admin/tournaments/${t.id}/seeds`, admin, {
        seeds: [
          { registrationId: regs[2], seed: 1 },
          { registrationId: regs[0], seed: 2 },
          { registrationId: regs[1], seed: 3 },
        ],
      }).expect(200);
      expect(reseed.body.map((r: { id: string; seed: number }) => [r.id, r.seed])).toEqual([
        [regs[2], 1],
        [regs[0], 2],
        [regs[1], 3],
      ]);
      expect(await auditCount('tournament.seeds', t.id)).toBe(2);
      const gen = await post(`/admin/tournaments/${t.id}/generate-bracket`, admin).expect(200);
      const bye = matchAt(gen.body, 1, 1);
      expect(bye.teamA!.id).toBe(teams[2]!.id); // seed 1 gets the bye
      expect(matchAt(gen.body, 1, 2).teamA!.id).toBe(teams[0]!.id); // seed 2 is team A vs seed 3
    });

    const byeCases: Array<[number, number, number[]]> = [
      // [teams, size, seeds with byes]
      [3, 4, [1]],
      [5, 8, [1, 2, 3]],
      [6, 8, [1, 2]],
    ];
    for (const [n, size, byeSeeds] of byeCases) {
      it(`N=${n}: size ${size}, byes for seeds ${byeSeeds.join(',')}, bye team placed in next match`, async () => {
        const { t, bracket } = await setupBracket(n, {
          defaultMatchFormat: 'BO3',
          finalMatchFormat: 'BO5',
        });
        expect(bracket.size).toBe(size);
        const rounds = Math.log2(size);
        expect(bracket.rounds.map((r) => r.matches.length)).toEqual(
          Array.from({ length: rounds }, (_, i) => size / 2 ** (i + 1)),
        );
        expect(bracket.rounds.at(-1)!.name).toBe('Final');
        expect(bracket.rounds.at(-1)!.matches[0]!.format).toBe('BO5');
        expect(bracket.rounds[0]!.matches[0]!.format).toBe('BO3');
        const byes = bracket.rounds[0]!.matches.filter((m) => m.isBye);
        expect(byes.map((m) => m.teamASeed).sort()).toEqual(byeSeeds);
        for (const m of byes) {
          expect(m).toMatchObject({ status: 'CANCELLED', statusReason: 'bye', teamB: null });
          const next = bracket.rounds[1]!.matches.find((x) => x.id === m.nextMatchId)!;
          const pos = m.slotNumber % 2 === 1 ? next.teamA : next.teamB;
          expect(pos?.id).toBe(m.teamA!.id);
        }
        for (const m of bracket.rounds[0]!.matches.filter((x) => !x.isBye)) {
          expect(m.status).toBe('CREATED');
          expect(m.teamASeed!).toBeLessThan(m.teamBSeed!);
        }
        // Public bracket = generation response; one initial transition per match; IN_PROGRESS.
        expect((await get(`/tournaments/${t.slug}/bracket`).expect(200)).body).toEqual(bracket);
        const matchCount = await db().match.count({ where: { tournamentId: t.id } });
        expect(matchCount).toBe(size - 1);
        expect(
          await db().matchStateTransition.count({
            where: { match: { tournamentId: t.id }, fromStatus: null },
          }),
        ).toBe(size - 1);
        expect((await get(`/tournaments/${t.slug}`).expect(200)).body.status).toBe('IN_PROGRESS');
        expect(await auditCount('bracket.generate', t.id)).toBe(1);
        const teamsRes = (await get(`/tournaments/${t.slug}/teams`).expect(200)).body;
        expect(teamsRes.map((x: { seed: number }) => x.seed)).toEqual(
          Array.from({ length: n }, (_, i) => i + 1),
        );
      });
    }

    it('concurrency: double generate-bracket ⇒ one bracket, 409 BRACKET_EXISTS; NOT_ENOUGH_TEAMS', async () => {
      const t = await mkTournament();
      for (let i = 0; i < 4; i++) await approveOk(t, (await registerOk(t, await mkTeam(5))).id);
      await setStatus(t, 'REGISTRATION_CLOSED').expect(200);
      const results = await Promise.all(
        Array.from({ length: 3 }, () => post(`/admin/tournaments/${t.id}/generate-bracket`, admin)),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      for (const r of results.filter((x) => x.status === 409))
        expect(r.body.code).toBe('BRACKET_EXISTS');
      expect(await db().tournamentStage.count({ where: { tournamentId: t.id } })).toBe(1);
      expect(await db().match.count({ where: { tournamentId: t.id } })).toBe(3);
      expect(await auditCount('bracket.generate', t.id)).toBe(1);
      const later = await post(`/admin/tournaments/${t.id}/generate-bracket`, admin).expect(409);
      expect(later.body.code).toBe('BRACKET_EXISTS');

      const lonely = await mkTournament();
      await approveOk(lonely, (await registerOk(lonely, await mkTeam(5))).id);
      await setStatus(lonely, 'REGISTRATION_CLOSED').expect(200);
      const one = await post(`/admin/tournaments/${lonely.id}/generate-bracket`, admin).expect(409);
      expect(one.body.code).toBe('NOT_ENOUGH_TEAMS');
    });

    it('idempotent replay of generate-bracket returns the stored response', async () => {
      const t = await mkTournament();
      for (let i = 0; i < 2; i++) await approveOk(t, (await registerOk(t, await mkTeam(5))).id);
      await setStatus(t, 'REGISTRATION_CLOSED').expect(200);
      const key = randomUUID();
      const first = await post(`/admin/tournaments/${t.id}/generate-bracket`, admin, undefined, {
        'Idempotency-Key': key,
      }).expect(200);
      const replay = await post(`/admin/tournaments/${t.id}/generate-bracket`, admin, undefined, {
        'Idempotency-Key': key,
      }).expect(200);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(await db().tournamentStage.count({ where: { tournamentId: t.id } })).toBe(1);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('veto', () => {
    it('turn and role enforcement, invalid maps, decider + match maps (BO3)', async () => {
      const { t, teams, bracket } = await setupBracket(2, { defaultMatchFormat: 'BO3' });
      const m = matchAt(bracket, 1, 1);
      const [a, b] = teams as [Team, Team];
      expect(m.teamA!.id).toBe(a.id);
      const path = `/matches/${m.id}/veto`;
      const state0 = (await get(path).expect(200)).body;
      expect(state0).toEqual({
        pool: POOL,
        actions: [],
        next: { teamId: a.id, action: 'BAN' },
        remaining: POOL,
        complete: false,
      });

      expect(
        (await post(path, b.captain, { action: 'BAN', mapName: 'de_alpha' }).expect(409)).body.code,
      ).toBe('VETO_NOT_YOUR_TURN');
      const outsider = await user();
      expect(
        (await post(path, outsider, { action: 'BAN', mapName: 'de_alpha' }).expect(403)).body.code,
      ).toBe('FORBIDDEN_ROLE');
      const ta = await user();
      await grant(ta, 'TOURNAMENT_ADMIN', 'TOURNAMENT', t.id);
      expect(
        (await post(path, ta, { action: 'BAN', mapName: 'de_alpha' }).expect(403)).body.code,
      ).toBe('FORBIDDEN_ROLE');
      expect(
        (await post(path, a.captain, { action: 'PICK', mapName: 'de_alpha' }).expect(409)).body
          .code,
      ).toBe('VETO_NOT_YOUR_TURN');
      expect(
        (await post(path, a.captain, { action: 'BAN', mapName: 'de_zulu' }).expect(409)).body.code,
      ).toBe('VETO_INVALID_MAP');
      await post(path, a.captain, { action: 'BAN', mapName: 'Mirage' }).expect(400);

      // A TEAM_MANAGER of team A may act for A.
      const manager = await user();
      await grant(manager, 'TEAM_MANAGER', 'TEAM', a.id);
      await post(path, manager, { action: 'BAN', mapName: 'de_alpha' }).expect(200);
      expect(
        (await post(path, b.captain, { action: 'BAN', mapName: 'de_alpha' }).expect(409)).body.code,
      ).toBe('VETO_INVALID_MAP');
      await post(path, b.captain, { action: 'BAN', mapName: 'de_bravo' }).expect(200);
      await post(path, a.captain, { action: 'PICK', mapName: 'de_charlie' }).expect(200);
      // SUPER_ADMIN acts as operator override (audited).
      await post(path, admin, { action: 'PICK', mapName: 'de_delta' }).expect(200);
      await post(path, a.captain, { action: 'BAN', mapName: 'de_echo' }).expect(200);
      const done = await post(path, b.captain, { action: 'BAN', mapName: 'de_foxtrot' }).expect(
        200,
      );
      expect(done.body).toMatchObject({ complete: true, next: null, remaining: [] });
      expect(done.body.actions.at(-1)).toMatchObject({
        sequence: 7,
        action: 'DECIDER',
        teamId: null,
        mapName: 'de_golf',
      });
      expect(
        (await post(path, a.captain, { action: 'BAN', mapName: 'de_golf' }).expect(409)).body.code,
      ).toBe('VETO_COMPLETE');
      const detail = (await get(`/matches/${m.id}`).expect(200)).body;
      expect(
        detail.maps.map((x: { mapOrder: number; mapName: string; status: string }) => [
          x.mapOrder,
          x.mapName,
          x.status,
        ]),
      ).toEqual([
        [1, 'de_charlie', 'PENDING'],
        [2, 'de_delta', 'PENDING'],
        [3, 'de_golf', 'PENDING'],
      ]);
      expect(await auditCount('match.veto', m.id)).toBe(6);
      const overrides = await db().auditLog.findMany({
        where: { action: 'match.veto', resourceId: m.id },
      });
      expect(
        overrides.filter((x) => (x.detailJson as { override?: boolean }).override),
      ).toHaveLength(1);
    });

    it('concurrency: simultaneous submissions for the same turn ⇒ exactly one recorded', async () => {
      const { bracket, teams } = await setupBracket(2);
      const m = matchAt(bracket, 1, 1);
      const a = teams[0]!;
      const results = await Promise.all(
        ['de_alpha', 'de_bravo', 'de_charlie', 'de_alpha'].map((mapName) =>
          post(`/matches/${m.id}/veto`, a.captain, { action: 'BAN', mapName }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      for (const r of results.filter((x) => x.status !== 200)) {
        expect(r.status).toBe(409);
        expect(['VETO_NOT_YOUR_TURN', 'VETO_INVALID_MAP']).toContain(r.body.code);
      }
      expect(await db().mapVetoAction.count({ where: { matchId: m.id } })).toBe(1);
    });

    it('veto needs both teams (TBD final → MATCH_NOT_READY)', async () => {
      const { bracket, teams } = await setupBracket(4);
      const final = matchAt(bracket, 2, 1);
      const r = await post(`/matches/${final.id}/veto`, teams[0]!.captain, {
        action: 'BAN',
        mapName: 'de_alpha',
      }).expect(409);
      expect(r.body.code).toBe('MATCH_NOT_READY');
      expect((await get(`/matches/${final.id}/veto`).expect(200)).body.next).toBeNull();
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('results and advancement', () => {
    it('final completes even when the planned start is in the future (live demo bug)', async () => {
      const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      const { t, bracket, teams } = await setupBracket(2, { startsAt: future });
      const afterGen = await db().tournament.findUniqueOrThrow({ where: { id: t.id } });
      expect(afterGen.startsAt!.getTime()).toBeLessThanOrEqual(Date.now());
      // Even if the planned start is pushed into the future again, completing works.
      await db().tournament.update({ where: { id: t.id }, data: { startsAt: new Date(future) } });
      const final = matchAt(bracket, 1, 1);
      await post(`/admin/matches/${final.id}/result-override`, admin, {
        winnerTeamId: teams[0]!.id,
        teamAScore: 1,
        teamBScore: 0,
        reason: 'final result entered by admin',
      }).expect(200);
      const done = await db().tournament.findUniqueOrThrow({ where: { id: t.id } });
      expect(done.status).toBe('COMPLETED');
      expect(done.endsAt!.getTime()).toBeGreaterThanOrEqual(done.startsAt!.getTime());
    });

    it('override validation, admin result never verified, winner published with source', async () => {
      const { bracket, teams } = await setupBracket(4, { defaultMatchFormat: 'BO3' });
      const m = matchAt(bracket, 1, 1);
      const path = `/admin/matches/${m.id}/result-override`;
      const [a] = teams as [Team];
      for (const [aScore, bScore] of [
        [1, 0],
        [2, 2],
        [3, 0],
        [1, 2],
      ]) {
        const r = await post(path, admin, {
          winnerTeamId: a.id,
          teamAScore: aScore,
          teamBScore: bScore,
          reason: 'admin entered',
        }).expect(400);
        expect(r.body.code).toBe('SCORE_INVALID');
      }
      const notParticipant = await post(path, admin, {
        winnerTeamId: teams[1]!.id,
        teamAScore: 2,
        teamBScore: 0,
        reason: 'admin entered',
      }).expect(400);
      expect(notParticipant.body.code).toBe('VALIDATION_FAILED');
      const noReason = await post(path, admin, {
        winnerTeamId: a.id,
        teamAScore: 2,
        teamBScore: 1,
      });
      expect(noReason.status).toBe(400);
      const stranger = await user();
      expect(
        (
          await post(path, stranger, {
            winnerTeamId: a.id,
            teamAScore: 2,
            teamBScore: 1,
            reason: 'x y z',
          }).expect(403)
        ).body.code,
      ).toBe('FORBIDDEN_ROLE');
      const tbd = await post(`/admin/matches/${matchAt(bracket, 2, 1).id}/result-override`, admin, {
        winnerTeamId: a.id,
        teamAScore: 2,
        teamBScore: 1,
        reason: 'too early',
      }).expect(409);
      expect(tbd.body.code).toBe('MATCH_NOT_READY');

      const ok = await post(path, admin, {
        winnerTeamId: a.id,
        teamAScore: 2,
        teamBScore: 1,
        reason: 'server crashed, scores from referee',
      }).expect(200);
      expect(ok.body).toMatchObject({
        status: 'COMPLETED',
        resultSource: 'ADMIN_OVERRIDE',
        resultVerifiedAt: null,
        teamAScore: 2,
        teamBScore: 1,
        winnerTeamId: a.id,
        winnerTeamSlug: a.slug,
        round: { roundNumber: 1, name: 'Semifinals' },
      });
      // A completed match announces no veto turn (GET mirrors what POST would accept).
      const vetoAfter = (await get(`/matches/${m.id}/veto`).expect(200)).body;
      expect(vetoAfter).toMatchObject({ next: null, complete: false });
      const row = await db().match.findUniqueOrThrow({ where: { id: m.id } });
      expect(row.version).toBe(1);
      const transitions = await db().matchStateTransition.findMany({
        where: { matchId: m.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(transitions.map((x) => [x.fromStatus, x.toStatus, x.source])).toEqual([
        [null, 'CREATED', 'ADMIN'],
        ['CREATED', 'COMPLETED', 'ADMIN'],
      ]);
      expect(await auditCount('match.result_override', m.id)).toBe(1);
      const final = await db().match.findUniqueOrThrow({
        where: { id: matchAt(bracket, 2, 1).id },
      });
      expect(final.teamAId).toBe(a.id);
      expect(await auditCount('match.advance', final.id)).toBe(1);
      const again = await post(path, admin, {
        winnerTeamId: a.id,
        teamAScore: 2,
        teamBScore: 0,
        reason: 'retry',
      }).expect(409);
      expect(again.body.code).toBe('MATCH_ALREADY_COMPLETED');
      // Results never set result_verified_at for admin sources.
      expect(
        await db().match.count({
          where: {
            resultSource: { in: ['ADMIN_OVERRIDE', 'FORFEIT'] },
            resultVerifiedAt: { not: null },
          },
        }),
      ).toBe(0);
    });

    it('concurrency: double override and override vs forfeit ⇒ exactly one result', async () => {
      const { bracket, teams } = await setupBracket(4);
      const [m1, m2] = [matchAt(bracket, 1, 1), matchAt(bracket, 1, 2)];
      const body = (winner: string) => ({
        winnerTeamId: winner,
        teamAScore: winner === m1.teamA!.id ? 1 : 0,
        teamBScore: winner === m1.teamA!.id ? 0 : 1,
        reason: 'referee decision',
      });
      const doubles = await Promise.all([
        post(`/admin/matches/${m1.id}/result-override`, admin, body(m1.teamA!.id)),
        post(`/admin/matches/${m1.id}/result-override`, admin, body(m1.teamB!.id)),
      ]);
      expect(doubles.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(doubles.find((r) => r.status === 409)!.body.code).toBe('MATCH_ALREADY_COMPLETED');
      const vs = await Promise.all([
        post(`/admin/matches/${m2.id}/result-override`, admin, {
          winnerTeamId: m2.teamA!.id,
          teamAScore: 1,
          teamBScore: 0,
          reason: 'referee decision',
        }),
        post(`/admin/matches/${m2.id}/forfeit`, admin, {
          forfeitingTeamId: m2.teamA!.id,
          reason: 'no show',
        }),
      ]);
      expect(vs.map((r) => r.status).sort()).toEqual([200, 409]);
      const transitions = await db().matchStateTransition.count({
        where: { matchId: { in: [m1.id, m2.id] }, toStatus: 'COMPLETED' },
      });
      expect(transitions).toBe(2);
      const final = await db().match.findUniqueOrThrow({
        where: { id: matchAt(bracket, 2, 1).id },
      });
      expect(final.teamAId).not.toBeNull();
      expect(final.teamBId).not.toBeNull();
      expect(teams.map((t) => t.id)).toEqual(
        expect.arrayContaining([final.teamAId, final.teamBId]),
      );
      const m2row = await db().match.findUniqueOrThrow({ where: { id: m2.id } });
      if (m2row.resultSource === 'FORFEIT') {
        expect(m2row.teamAScore).toBeNull();
        expect(m2row.winnerTeamId).toBe(m2.teamB!.id);
      }
    });

    it('concurrency: two semifinals completing at once both land in the final; final completes the tournament', async () => {
      const { t, bracket, teams } = await setupBracket(4);
      const [s1, s2, f] = [matchAt(bracket, 1, 1), matchAt(bracket, 1, 2), matchAt(bracket, 2, 1)];
      const [r1, r2] = await Promise.all([
        post(`/admin/matches/${s1.id}/forfeit`, admin, {
          forfeitingTeamId: s1.teamB!.id,
          reason: 'no show',
        }),
        post(`/admin/matches/${s2.id}/result-override`, admin, {
          winnerTeamId: s2.teamB!.id,
          teamAScore: 0,
          teamBScore: 1,
          reason: 'referee decision',
        }),
      ]);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      expect(r1.body).toMatchObject({
        resultSource: 'FORFEIT',
        teamAScore: null,
        teamBScore: null,
      });
      const final = (await get(`/matches/${f.id}`).expect(200)).body;
      expect(final.teamA.id).toBe(s1.teamA!.id);
      expect(final.teamB.id).toBe(s2.teamB!.id);
      expect(final.round).toEqual({ roundNumber: 2, name: 'Final' });

      const done = await post(`/admin/matches/${f.id}/result-override`, admin, {
        winnerTeamId: final.teamB.id,
        teamAScore: 0,
        teamBScore: 1,
        reason: 'referee decision',
      }).expect(200);
      expect(done.body.status).toBe('COMPLETED');
      expect((await get(`/tournaments/${t.slug}`).expect(200)).body.status).toBe('COMPLETED');
      const achievements = await db().teamAchievement.findMany({
        where: { tournamentId: t.id },
        orderBy: { placement: 'asc' },
      });
      expect(achievements.map((x) => [x.teamId, x.placement])).toEqual([
        [final.teamB.id, 1],
        [final.teamA.id, 2],
      ]);
      expect(
        await db().auditLog.count({
          where: { action: 'tournament.status_change', resourceId: t.id },
        }),
      ).toBe(4); // →OPEN, →CLOSED, →IN_PROGRESS (bracket), →COMPLETED (final)
      const bracketNow = (await get(`/tournaments/${t.slug}/bracket`).expect(200)).body as Bracket;
      expect(matchAt(bracketNow, 2, 1).winnerTeamId).toBe(final.teamB.id);
      expect(teams).toHaveLength(4);
      // Further changes are refused.
      expect((await setStatus(t, 'CANCELLED', 'too late').expect(409)).body.code).toBe(
        'INVALID_STATE_TRANSITION',
      );
    });

    it('match admin scopes: MATCH-scoped grant can enter that result only; admin match list is scoped', async () => {
      const { t, bracket } = await setupBracket(4);
      const [m1, m2] = [matchAt(bracket, 1, 1), matchAt(bracket, 1, 2)];
      const ma = await user();
      await grant(ma, 'MATCH_ADMIN', 'MATCH', m1.id);
      const list = await get('/admin/matches?pageSize=100', ma).expect(200);
      expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([m1.id]);
      const all = await get(`/admin/matches?tournamentId=${t.id}&status=CREATED`, admin).expect(
        200,
      );
      expect(all.body.total).toBe(3);
      expect(
        (
          await post(`/admin/matches/${m2.id}/forfeit`, ma, {
            forfeitingTeamId: m2.teamA!.id,
            reason: 'no show',
          }).expect(403)
        ).body.code,
      ).toBe('FORBIDDEN_ROLE');
      await post(`/admin/matches/${m1.id}/forfeit`, ma, {
        forfeitingTeamId: m1.teamA!.id,
        reason: 'no show',
      }).expect(200);
      expect(await auditCount('match.forfeit', m1.id)).toBe(1);
    });

    it('cancelling a running tournament cancels open matches through the state machine', async () => {
      const { t, bracket } = await setupBracket(3);
      const open = await db().match.count({ where: { tournamentId: t.id, status: 'CREATED' } });
      expect(open).toBe(2);
      await setStatus(t, 'CANCELLED', 'venue lost').expect(200);
      const rows = await db().match.findMany({ where: { tournamentId: t.id } });
      expect(rows.every((r) => r.status === 'CANCELLED')).toBe(true);
      const cancelled = await db().matchStateTransition.findMany({
        where: { match: { tournamentId: t.id }, toStatus: 'CANCELLED', fromStatus: 'CREATED' },
      });
      expect(cancelled).toHaveLength(2);
      expect(cancelled.every((x) => x.source === 'ADMIN' && x.reason === 'venue lost')).toBe(true);
      const bye = matchAt(bracket, 1, 1);
      expect((await db().match.findUniqueOrThrow({ where: { id: bye.id } })).statusReason).toBe(
        'bye',
      );
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('sample resources', () => {
    it('sample tournaments, teams and matches are never mutated (409 SAMPLE_RESOURCE)', async () => {
      const u = uniq();
      const st = await db().tournament.create({
        data: {
          slug: `sample-cup-${u}`,
          name: `Sample Cup ${u}`,
          format: 'SINGLE_ELIMINATION',
          status: 'REGISTRATION_OPEN',
          maxTeams: 8,
          settingsJson: { mapPool: POOL },
          isSample: true,
        },
      });
      const team = await mkTeam(5);
      const res = await register({ id: st.id, slug: st.slug }, team).expect(409);
      expect(res.body.code).toBe('SAMPLE_RESOURCE');
      expect(
        (await setStatus({ id: st.id, slug: st.slug }, 'REGISTRATION_CLOSED').expect(409)).body
          .code,
      ).toBe('SAMPLE_RESOURCE');
      expect(
        (await patch(`/admin/tournaments/${st.id}`, admin, { maxTeams: 4 }).expect(409)).body.code,
      ).toBe('SAMPLE_RESOURCE');

      const sampleTeam = await db().team.create({
        data: { slug: `sample-team-${u}`, name: `Sample Team ${u}`, tag: newTag(), isSample: true },
      });
      const t = await mkTournament();
      const sres = await post(`/tournaments/${t.id}/registrations`, admin, {
        teamId: sampleTeam.id,
        starters: team.members.slice(0, 5),
        substitutes: [],
      }).expect(409);
      expect(sres.body.code).toBe('SAMPLE_RESOURCE');

      const sampleMatch = await db().match.create({
        data: { tournamentId: st.id, teamAId: team.id, teamBId: sampleTeam.id, isSample: true },
      });
      expect(
        (
          await post(`/admin/matches/${sampleMatch.id}/forfeit`, admin, {
            forfeitingTeamId: team.id,
            reason: 'sample',
          }).expect(409)
        ).body.code,
      ).toBe('SAMPLE_RESOURCE');
      expect(
        (
          await post(`/matches/${sampleMatch.id}/veto`, team.captain, {
            action: 'BAN',
            mapName: 'de_alpha',
          }).expect(409)
        ).body.code,
      ).toBe('SAMPLE_RESOURCE');
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('admin results with per-map round scores', () => {
    /** Completes the veto with captains acting on their turns (first remaining map each time). */
    async function completeVeto(matchId: string, teams: Team[]) {
      const captainOf = new Map(teams.map((t) => [t.id, t.captain]));
      for (;;) {
        const state = (await get(`/matches/${matchId}/veto`).expect(200)).body as {
          next: { teamId: string; action: string } | null;
          remaining: string[];
          complete: boolean;
        };
        if (state.complete || !state.next) return;
        await post(`/matches/${matchId}/veto`, captainOf.get(state.next.teamId)!, {
          action: state.next.action,
          mapName: state.remaining[0],
        }).expect(200);
      }
    }

    it('BO1 13–9 → series 1–0, map FINISHED, winner advances; maps before veto → 409', async () => {
      const { bracket, teams } = await setupBracket(4);
      const [m1, m2] = [matchAt(bracket, 1, 1), matchAt(bracket, 1, 2)];
      const early = await post(`/admin/matches/${m2.id}/result-override`, admin, {
        maps: [{ mapOrder: 1, teamAScore: 13, teamBScore: 9 }],
        reason: 'referee sheet',
      }).expect(409);
      expect(early.body.code).toBe('MATCH_NOT_READY');

      await completeVeto(m1.id, teams);
      const res = await post(`/admin/matches/${m1.id}/result-override`, admin, {
        maps: [{ mapOrder: 1, teamAScore: 9, teamBScore: 13 }],
        reason: 'referee sheet',
      }).expect(200);
      expect(res.body).toMatchObject({
        status: 'COMPLETED',
        resultSource: 'ADMIN_OVERRIDE',
        resultVerifiedAt: null,
        teamAScore: 0,
        teamBScore: 1,
        winnerTeamId: m1.teamB!.id,
      });
      expect(res.body.maps).toEqual([
        expect.objectContaining({
          mapOrder: 1,
          status: 'FINISHED',
          teamAScore: 9,
          teamBScore: 13,
          winnerTeamId: m1.teamB!.id,
        }),
      ]);
      const final = await db().match.findUniqueOrThrow({
        where: { id: matchAt(bracket, 2, 1).id },
      });
      expect(final.teamAId).toBe(m1.teamB!.id);
      const audit = await db().auditLog.findFirstOrThrow({
        where: { action: 'match.result_override', resourceId: m1.id },
      });
      expect(audit.detailJson).toMatchObject({
        teamAScore: 0,
        teamBScore: 1,
        maps: [{ mapOrder: 1, status: 'FINISHED', teamAScore: 9, teamBScore: 13 }],
      });
    });

    it('BO3 13–9, 7–13, 16–14 → 2–1; public detail shows map scores with ADMIN_OVERRIDE', async () => {
      const { t, bracket, teams } = await setupBracket(2, { defaultMatchFormat: 'BO3' });
      const m = matchAt(bracket, 1, 1);
      await completeVeto(m.id, teams);
      await post(`/admin/matches/${m.id}/result-override`, admin, {
        winnerTeamId: m.teamA!.id, // optional; must match when sent
        teamAScore: 2,
        teamBScore: 1,
        maps: [
          { mapOrder: 1, teamAScore: 13, teamBScore: 9 },
          { mapOrder: 2, teamAScore: 7, teamBScore: 13 },
          { mapOrder: 3, teamAScore: 16, teamBScore: 14 },
        ],
        reason: 'LAN referee sheet',
      }).expect(200);
      const pub = (await get(`/matches/${m.id}`).expect(200)).body;
      expect(pub).toMatchObject({
        resultSource: 'ADMIN_OVERRIDE',
        resultVerifiedAt: null,
        teamAScore: 2,
        teamBScore: 1,
        winnerTeamId: m.teamA!.id,
      });
      expect(
        pub.maps.map(
          (x: {
            mapOrder: number;
            status: string;
            teamAScore: number;
            teamBScore: number;
            winnerTeamId: string;
          }) => [x.mapOrder, x.status, x.teamAScore, x.teamBScore, x.winnerTeamId],
        ),
      ).toEqual([
        [1, 'FINISHED', 13, 9, m.teamA!.id],
        [2, 'FINISHED', 7, 13, m.teamB!.id],
        [3, 'FINISHED', 16, 14, m.teamA!.id],
      ]);
      expect((await get(`/tournaments/${t.slug}`).expect(200)).body.status).toBe('COMPLETED');
    });

    it('BO3 2–0: unplayed third map CANCELLED without scores; mismatches and bad lists → 400', async () => {
      const { bracket, teams } = await setupBracket(2, { defaultMatchFormat: 'BO3' });
      const m = matchAt(bracket, 1, 1);
      await completeVeto(m.id, teams);
      const path = `/admin/matches/${m.id}/result-override`;
      const twoNil = [
        { mapOrder: 1, teamAScore: 13, teamBScore: 5 },
        { mapOrder: 2, teamAScore: 13, teamBScore: 11 },
      ];
      const scoreInvalidBodies = [
        { maps: twoNil, winnerTeamId: m.teamB!.id },
        { maps: twoNil, teamAScore: 2, teamBScore: 1 },
        { maps: [...twoNil, { mapOrder: 3, teamAScore: 13, teamBScore: 2 }] },
        { maps: [{ mapOrder: 1, teamAScore: 13, teamBScore: 13 }, twoNil[1]] },
        { maps: [twoNil[0], { mapOrder: 3, teamAScore: 13, teamBScore: 2 }] },
        { maps: [twoNil[0]] },
      ];
      for (const body of scoreInvalidBodies) {
        const r = await post(path, admin, { ...body, reason: 'referee sheet' }).expect(400);
        expect(r.body.code, JSON.stringify(body)).toBe('SCORE_INVALID');
      }
      for (const body of [
        { maps: [{ mapOrder: 1, teamAScore: 100, teamBScore: 5 }, twoNil[1]] },
        { maps: [] },
        {}, // neither maps nor series fields
      ]) {
        const r = await post(path, admin, { ...body, reason: 'referee sheet' }).expect(400);
        expect(r.body.code).toBe('VALIDATION_FAILED');
      }
      expect((await db().match.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('CREATED');

      await post(path, admin, { maps: twoNil, reason: 'referee sheet' }).expect(200);
      const maps = await db().matchMap.findMany({
        where: { matchId: m.id },
        orderBy: { mapOrder: 'asc' },
      });
      expect(maps.map((x) => x.status)).toEqual(['FINISHED', 'FINISHED', 'CANCELLED']);
      expect(maps[2]!.winnerTeamId).toBeNull();
      const pub = (await get(`/matches/${m.id}`).expect(200)).body;
      expect(pub).toMatchObject({ teamAScore: 2, teamBScore: 0 });
      expect(pub.maps[2]).toMatchObject({
        status: 'CANCELLED',
        teamAScore: null,
        teamBScore: null,
        winnerTeamId: null,
      });
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('M3 gate fixes', () => {
    const auditOf = async (action: string, resourceId: string) =>
      (await db().auditLog.findMany({ where: { action, resourceId } })).map(
        (a) => a.detailJson as Record<string, unknown>,
      );

    it('L-3 (a): an operator of BOTH teams cannot veto (403 CONFLICT_OF_INTEREST); SUPER_ADMIN audited', async () => {
      const { bracket, teams } = await setupBracket(2);
      const m = matchAt(bracket, 1, 1);
      const both = await user();
      await grant(both, 'TEAM_MANAGER', 'TEAM', teams[0]!.id);
      await grant(both, 'TEAM_MANAGER', 'TEAM', teams[1]!.id);
      const res = await post(`/matches/${m.id}/veto`, both, {
        action: 'BAN',
        mapName: 'de_alpha',
      }).expect(403);
      expect(res.body.code).toBe('CONFLICT_OF_INTEREST');
      expect(await db().mapVetoAction.count({ where: { matchId: m.id } })).toBe(0);
      // A manager of only the acting team is fine.
      const one = await user();
      await grant(one, 'TEAM_MANAGER', 'TEAM', teams[0]!.id);
      await post(`/matches/${m.id}/veto`, one, { action: 'BAN', mapName: 'de_alpha' }).expect(200);
      // SUPER_ADMIN who manages both teams may act; audited as override + conflict.
      await grant(admin, 'TEAM_MANAGER', 'TEAM', teams[0]!.id);
      await grant(admin, 'TEAM_MANAGER', 'TEAM', teams[1]!.id);
      await post(`/matches/${m.id}/veto`, admin, { action: 'BAN', mapName: 'de_bravo' }).expect(
        200,
      );
      const details = await auditOf('match.veto', m.id);
      expect(
        details.filter((d) => d.conflictOfInterest === true && d.override === true),
      ).toHaveLength(1);
      await revokeTeamManagerGrants(admin.id);
    });

    it('L-3 (b): a match admin operating either team cannot enter results; SUPER_ADMIN audited', async () => {
      const { bracket } = await setupBracket(4);
      const [m1, m2] = [matchAt(bracket, 1, 1), matchAt(bracket, 1, 2)];
      const ma = await user();
      await grant(ma, 'MATCH_ADMIN', 'GLOBAL');
      await grant(ma, 'TEAM_MANAGER', 'TEAM', m1.teamB!.id);
      const forfeit = await post(`/admin/matches/${m1.id}/forfeit`, ma, {
        forfeitingTeamId: m1.teamA!.id,
        reason: 'no show',
      }).expect(403);
      expect(forfeit.body.code).toBe('CONFLICT_OF_INTEREST');
      const override = await post(`/admin/matches/${m1.id}/result-override`, ma, {
        winnerTeamId: m1.teamB!.id,
        teamAScore: 0,
        teamBScore: 1,
        reason: 'referee decision',
      }).expect(403);
      expect(override.body.code).toBe('CONFLICT_OF_INTEREST');
      expect((await db().match.findUniqueOrThrow({ where: { id: m1.id } })).status).toBe('CREATED');
      // Not involved in m2 → allowed.
      await post(`/admin/matches/${m2.id}/forfeit`, ma, {
        forfeitingTeamId: m2.teamA!.id,
        reason: 'no show',
      }).expect(200);
      // SUPER_ADMIN managing a team of m1: allowed, audited.
      await grant(admin, 'TEAM_MANAGER', 'TEAM', m1.teamA!.id);
      await post(`/admin/matches/${m1.id}/forfeit`, admin, {
        forfeitingTeamId: m1.teamB!.id,
        reason: 'no show',
      }).expect(200);
      expect(await auditOf('match.forfeit', m1.id)).toEqual([
        expect.objectContaining({ override: true, conflictOfInterest: true }),
      ]);
      await revokeTeamManagerGrants(admin.id);
    });

    it('L-3 (c): a tournament admin operating the team cannot approve/reject it; SUPER_ADMIN audited', async () => {
      const t = await mkTournament();
      const ta = await user();
      await grant(ta, 'TOURNAMENT_ADMIN', 'GLOBAL');
      const own = await mkTeam(5, ta); // ta captains this team
      const reg = await registerOk(t, own);
      for (const action of ['approve', 'reject']) {
        const res = await post(
          `/admin/tournaments/${t.id}/registrations/${reg.id}/${action}`,
          ta,
          action === 'reject' ? { reason: 'self review' } : {},
        ).expect(403);
        expect(res.body.code).toBe('CONFLICT_OF_INTEREST');
      }
      const other = await mkTeam(5);
      const otherReg = await registerOk(t, other);
      await post(`/admin/tournaments/${t.id}/registrations/${otherReg.id}/approve`, ta, {}).expect(
        200,
      );
      await grant(admin, 'TEAM_MANAGER', 'TEAM', own.id);
      await post(`/admin/tournaments/${t.id}/registrations/${reg.id}/approve`, admin, {}).expect(
        200,
      );
      expect(await auditOf('registration.approve', reg.id)).toEqual([
        expect.objectContaining({ override: true, conflictOfInterest: true }),
      ]);
      await revokeTeamManagerGrants(admin.id);
    });

    it('L-3 (d): two teams sharing a captain/manager cannot both enter a tournament (409)', async () => {
      const t = await mkTournament();
      const x = await mkTeam(5);
      const y = await mkTeam(5);
      await grant(x.captain, 'TEAM_MANAGER', 'TEAM', y.id); // x's captain also manages y
      const regX = await registerOk(t, x);
      const res = await register(t, y).expect(409);
      expect(res.body.code).toBe('CONFLICT_OF_INTEREST');
      // A shared TEAM_MANAGER (not a captain) also counts.
      const z = await mkTeam(5);
      const w = await mkTeam(5);
      const shared = await user();
      await grant(shared, 'TEAM_MANAGER', 'TEAM', z.id);
      await grant(shared, 'TEAM_MANAGER', 'TEAM', w.id);
      await registerOk(t, z);
      expect((await register(t, w).expect(409)).body.code).toBe('CONFLICT_OF_INTEREST');
      // After X withdraws, Y may register.
      await post(`/tournaments/${t.id}/registrations/${regX.id}/withdraw`, x.captain).expect(200);
      await registerOk(t, y);
    });

    it('L-4: admin registration view flags players no longer on the team', async () => {
      const t = await mkTournament();
      const team = await mkTeam(5);
      const reg = await registerOk(t, team);
      await approveOk(t, reg.id);
      const gone = team.members[3]!;
      await db().teamMembership.updateMany({
        where: { teamId: team.id, userId: gone, leftAt: null },
        data: { leftAt: new Date(), leftReason: 'left' },
      });
      const list = await get(`/admin/tournaments/${t.id}/registrations`, admin).expect(200);
      const entries = list.body.items[0].roster.entries as Array<{
        userId: string;
        noLongerMember: boolean;
      }>;
      expect(entries).toHaveLength(5);
      for (const e of entries) expect(e.noLongerMember).toBe(e.userId === gone);
      // The snapshot itself is unchanged; the operator view carries no such flag.
      const mine = await get('/me/registrations', team.captain).expect(200);
      expect(mine.body[0].roster.entries.map((e: { userId: string }) => e.userId)).toContain(gone);
      expect(mine.body[0].roster.entries[0].noLongerMember).toBeUndefined();
    });

    it('I-1: tournament datetimes need an explicit offset', async () => {
      const base = {
        format: 'SINGLE_ELIMINATION',
        defaultMatchFormat: 'BO1',
        maxTeams: 8,
        mapPool: POOL,
      };
      for (const value of ['2026-12-01T18:00:00', '2026-12-01', '2026-12-01T18:00:00.000']) {
        const res = await post('/admin/tournaments', admin, {
          ...base,
          name: `Offsetless ${uniq()}`,
          startsAt: value,
        }).expect(400);
        expect(res.body.details[0].field).toBe('startsAt');
      }
      const ok = await post('/admin/tournaments', admin, {
        ...base,
        name: `Offset ${uniq()}`,
        registrationOpenAt: '2026-12-01T10:00:00+05:00',
        registrationCloseAt: '2026-12-01T06:00:00Z',
        startsAt: '2026-12-02T18:00:00.000Z',
      }).expect(201);
      expect(ok.body.registrationOpenAt).toBe('2026-12-01T05:00:00.000Z');
      const bad = await patch(`/admin/tournaments/${ok.body.id}`, admin, {
        registrationCloseAt: '2026-12-01T20:00:00',
      }).expect(400);
      expect(bad.body.code).toBe('VALIDATION_FAILED');
    });

    it('I-5: approve and generate-bracket require ACTIVE teams (409 TEAM_NOT_ACTIVE)', async () => {
      const t = await mkTournament();
      const teams = [await mkTeam(5), await mkTeam(5), await mkTeam(5)];
      const regs = [];
      for (const team of teams) regs.push(await registerOk(t, team));
      await db().team.update({ where: { id: teams[2]!.id }, data: { status: 'DISBANDED' } });
      const refused = await post(
        `/admin/tournaments/${t.id}/registrations/${regs[2]!.id}/approve`,
        admin,
        {},
      ).expect(409);
      expect(refused.body.code).toBe('TEAM_NOT_ACTIVE');
      await db().team.update({ where: { id: teams[2]!.id }, data: { status: 'ACTIVE' } });
      for (const r of regs) await approveOk(t, r.id);
      await db().team.update({ where: { id: teams[1]!.id }, data: { status: 'DISBANDED' } });
      await setStatus(t, 'REGISTRATION_CLOSED').expect(200);
      const gen = await post(`/admin/tournaments/${t.id}/generate-bracket`, admin).expect(409);
      expect(gen.body).toMatchObject({
        code: 'TEAM_NOT_ACTIVE',
        details: [{ field: regs[1]!.id, message: 'TEAM_NOT_ACTIVE' }],
      });
      expect(await db().tournamentStage.count({ where: { tournamentId: t.id } })).toBe(0);
      // SUPER_ADMIN (operator override) withdraws it; generation then succeeds with 2 teams.
      await post(`/tournaments/${t.id}/registrations/${regs[1]!.id}/withdraw`, admin).expect(200);
      const ok = await post(`/admin/tournaments/${t.id}/generate-bracket`, admin).expect(200);
      expect(ok.body.size).toBe(2);
    });
  });

  it('every M3 audit action was written at least once by this suite', async () => {
    for (const action of [
      'tournament.create',
      'tournament.update',
      'tournament.status_change',
      'registration.submit',
      'registration.roster_update',
      'registration.withdraw',
      'registration.approve',
      'registration.reject',
      'registration.substitute',
      'tournament.seeds',
      'bracket.generate',
      'match.veto',
      'match.result_override',
      'match.forfeit',
      'match.advance',
      'steam_ban.create',
      'steam_ban.lift',
    ]) {
      expect(await auditCount(action), action).toBeGreaterThan(0);
    }
  });
});

import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StubSteamProvider, testSteamId } from '../support/steam-stub.js';
import { createAuthTestApp, type LoggedIn, login, WEB } from './auth-helpers.js';
import { prismaOf, sampleSteamId, truncateAll } from './helpers.js';

type Who = LoggedIn & { id: string; steamId64: string };

const POOL = [
  'de_sample_alpha',
  'de_sample_bravo',
  'de_sample_charlie',
  'de_sample_delta',
  'de_sample_echo',
  'de_sample_foxtrot',
  'de_sample_golf',
];

/**
 * Dev-only demo mode (ALLOW_SAMPLE_MUTATIONS=true): the M3 flow works end to end on SAMPLE data
 * inside sample tournaments, sample data never leaks into real tournaments, and M2 sample guards
 * stay in force. The flag-off behaviour is covered by m3-tournaments.int.test.ts.
 */
describe('M3 demo mode: ALLOW_SAMPLE_MUTATIONS=true (real PostgreSQL + Redis)', () => {
  let app: NestExpressApplication;
  let op: StubSteamProvider;
  const adminSteamId = testSteamId();
  let admin: Who;
  let seq = 0;
  let tagSeq = 0;

  const db = () => prismaOf(app);
  const uniq = () => `${Date.now().toString(36).slice(-4)}${(seq += 1)}`;
  const newTag = () => `S${(tagSeq++).toString(36).toUpperCase().padStart(4, '0')}`;

  function post(path: string, who: LoggedIn, body: object = {}) {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Origin', WEB)
      .set('Cookie', who.cookie)
      .set('x-csrf-token', who.csrf)
      .send(body);
  }
  const get = (path: string, who?: LoggedIn) => {
    const r = request(app.getHttpServer()).get(`/api/v1${path}`);
    return who ? r.set('Cookie', who.cookie) : r;
  };

  async function user(steamId64 = testSteamId()): Promise<Who> {
    const session = await login(app, op, steamId64);
    const row = await db().user.findUniqueOrThrow({ where: { steamId64 } });
    return { ...session, id: row.id, steamId64 };
  }

  async function sampleUser() {
    const u = uniq();
    return db().user.create({
      data: {
        steamId64: sampleSteamId(),
        isSample: true,
        playerProfile: { create: { nickname: `demo.p${u}`, slug: `demo-p-${u}` } },
      },
    });
  }

  /** Sample team: sample captain + 4 sample players (created directly; they cannot sign in). */
  async function sampleTeam() {
    const u = uniq();
    const team = await db().team.create({
      data: { slug: `demo-t-${u}`, name: `Demo T ${u}`, tag: newTag(), isSample: true },
    });
    const members = [];
    for (let i = 0; i < 5; i++) {
      const p = await sampleUser();
      await db().teamMembership.create({
        data: { teamId: team.id, userId: p.id, role: i === 0 ? 'CAPTAIN' : 'PLAYER' },
      });
      members.push(p);
    }
    return { ...team, members };
  }

  async function sampleTournament() {
    const u = uniq();
    return db().tournament.create({
      data: {
        slug: `demo-cup-${u}`,
        name: `Demo Cup ${u}`,
        format: 'SINGLE_ELIMINATION',
        status: 'REGISTRATION_OPEN',
        defaultMatchFormat: 'BO1',
        maxTeams: 8,
        settingsJson: { sample: true, mapPool: POOL, finalMatchFormat: 'BO3' },
        isSample: true,
      },
    });
  }

  /** PENDING registration with roster v1 DRAFT, as created by `db:seed:demo`. */
  async function pendingRegistration(
    tournamentId: string,
    team: { id: string; members: { id: string; steamId64: string }[] },
  ) {
    const reg = await db().tournamentRegistration.create({
      data: { tournamentId, teamId: team.id, requestedById: team.members[0]!.id },
    });
    const roster = await db().tournamentRoster.create({
      data: { registrationId: reg.id, version: 1, status: 'DRAFT' },
    });
    await db().tournamentRosterEntry.createMany({
      data: team.members.map((m, i) => ({
        rosterId: roster.id,
        userId: m.id,
        steamId64Snapshot: m.steamId64,
        nicknameSnapshot: `snap${i}`,
        role: 'STARTER' as const,
      })),
    });
    return reg;
  }

  async function realTournament() {
    const res = await post('/admin/tournaments', admin, {
      name: `Real Cup ${uniq()}`,
      format: 'SINGLE_ELIMINATION',
      defaultMatchFormat: 'BO1',
      maxTeams: 8,
      mapPool: POOL,
    }).expect(201);
    await post(`/admin/tournaments/${res.body.id}/status`, admin, {
      to: 'REGISTRATION_OPEN',
    }).expect(200);
    return res.body as { id: string; slug: string };
  }

  /** Real team: signed-in captain + 5 real players. */
  async function realTeam() {
    const captain = await user();
    const u = uniq();
    const team = await db().team.create({
      data: { slug: `real-t-${u}`, name: `Real T ${u}`, tag: newTag() },
    });
    await db().teamMembership.create({
      data: { teamId: team.id, userId: captain.id, role: 'CAPTAIN' },
    });
    const members = [captain.id];
    for (let i = 0; i < 5; i++) {
      const p = await db().user.create({
        data: {
          steamId64: testSteamId(),
          playerProfile: { create: { nickname: `r${uniq()}`, slug: `real-p-${uniq()}` } },
        },
      });
      await db().teamMembership.create({
        data: { teamId: team.id, userId: p.id, role: 'PLAYER' },
      });
      members.push(p.id);
    }
    return { ...team, captain, members };
  }

  beforeAll(async () => {
    ({ app, op } = await createAuthTestApp({
      BOOTSTRAP_SUPER_ADMIN_STEAM_ID64: adminSteamId,
      ALLOW_SAMPLE_MUTATIONS: 'true',
    }));
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

  it('GET /meta reports the feature as enabled', async () => {
    const res = await get('/meta').expect(200);
    expect(res.body.features.sampleMutations).toEqual({ status: 'enabled' });
  });

  it('full flow on a sample tournament: approve → bracket → veto → results → COMPLETED', async () => {
    const t = await sampleTournament();
    const teams = [await sampleTeam(), await sampleTeam(), await sampleTeam(), await sampleTeam()];
    const regs = [];
    for (const team of teams) regs.push(await pendingRegistration(t.id, team));

    // A real team may also register into a sample tournament; a SUPER_ADMIN can register a
    // sample team (operator override).
    const real = await realTeam();
    const realReg = await post(`/tournaments/${t.id}/registrations`, real.captain, {
      teamId: real.id,
      starters: real.members.slice(0, 5),
      substitutes: [],
    }).expect(201);
    const extra = await sampleTeam();
    const extraReg = await post(`/tournaments/${t.id}/registrations`, admin, {
      teamId: extra.id,
      starters: extra.members.map((m) => m.id),
      substitutes: [],
    }).expect(201);
    expect(extraReg.body.roster.status).toBe('DRAFT');
    for (const id of [realReg.body.id, extraReg.body.id]) {
      await post(`/admin/tournaments/${t.id}/registrations/${id}/reject`, admin, {
        reason: 'demo: not needed',
      }).expect(200);
    }

    for (const r of regs) {
      const res = await post(`/admin/tournaments/${t.id}/registrations/${r.id}/approve`, admin);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ status: 'APPROVED', isSample: true });
      expect(res.body.roster.status).toBe('LOCKED');
    }
    const approveAudit = await db().auditLog.findFirstOrThrow({
      where: { action: 'registration.approve', resourceId: regs[0]!.id },
    });
    expect(approveAudit.detailJson).toMatchObject({ sample: true });

    await post(`/admin/tournaments/${t.id}/status`, admin, { to: 'REGISTRATION_CLOSED' }).expect(
      200,
    );
    const gen = await post(`/admin/tournaments/${t.id}/generate-bracket`, admin).expect(200);
    const semis = gen.body.rounds[0].matches as Array<{
      id: string;
      teamA: { id: string };
      teamB: { id: string };
      isSample: boolean;
    }>;
    const final = gen.body.rounds[1].matches[0] as { id: string; format: string };
    expect(final.format).toBe('BO3');
    expect(semis.every((m) => m.isSample)).toBe(true);
    expect(await db().match.count({ where: { tournamentId: t.id, isSample: false } })).toBe(0);

    // SUPER_ADMIN vetoes for the sample teams (operator override), BO1 sequence to the decider.
    const veto = `/matches/${semis[0]!.id}/veto`;
    for (const map of POOL.slice(0, 6)) {
      await post(veto, admin, { action: 'BAN', mapName: map }).expect(200);
    }
    const state = await get(veto).expect(200);
    expect(state.body).toMatchObject({ complete: true, remaining: [] });
    const vetoAudits = await db().auditLog.findMany({
      where: { action: 'match.veto', resourceId: semis[0]!.id },
    });
    expect(vetoAudits).toHaveLength(6);
    for (const a of vetoAudits)
      expect(a.detailJson).toMatchObject({ sample: true, override: true });

    // Results: override + forfeit advance into the final; the final completes the tournament.
    const s1 = await post(`/admin/matches/${semis[0]!.id}/result-override`, admin, {
      winnerTeamId: semis[0]!.teamA.id,
      teamAScore: 1,
      teamBScore: 0,
      reason: 'demo result',
    }).expect(200);
    expect(s1.body).toMatchObject({
      status: 'COMPLETED',
      resultSource: 'ADMIN_OVERRIDE',
      resultVerifiedAt: null,
      isSample: true,
    });
    await post(`/admin/matches/${semis[1]!.id}/forfeit`, admin, {
      forfeitingTeamId: semis[1]!.teamA.id,
      reason: 'demo forfeit',
    }).expect(200);
    const fin = await get(`/matches/${final.id}`).expect(200);
    expect(fin.body.teamA.id).toBe(semis[0]!.teamA.id);
    expect(fin.body.teamB.id).toBe(semis[1]!.teamB.id);
    await post(`/admin/matches/${final.id}/result-override`, admin, {
      winnerTeamId: fin.body.teamB.id,
      teamAScore: 1,
      teamBScore: 2,
      reason: 'demo final',
    }).expect(200);
    expect((await get(`/tournaments/${t.slug}`).expect(200)).body).toMatchObject({
      status: 'COMPLETED',
      isSample: true,
    });
    expect(
      await db().match.count({
        where: { tournamentId: t.id, resultVerifiedAt: { not: null } },
      }),
    ).toBe(0);
    for (const action of ['bracket.generate', 'match.result_override', 'match.advance']) {
      const rows = await db().auditLog.findMany({ where: { action } });
      expect(rows.length, action).toBeGreaterThan(0);
      for (const r of rows) expect(r.detailJson, action).toMatchObject({ sample: true });
    }
    expect(await db().teamAchievement.count({ where: { tournamentId: t.id } })).toBe(2);
  });

  it('sample players/teams never reach a NON-sample tournament, even with the flag', async () => {
    const t = await realTournament();
    const team = await realTeam();
    const sp = await sampleUser();
    await db().teamMembership.create({ data: { teamId: team.id, userId: sp.id, role: 'PLAYER' } });

    // (a) register a real team with a sample player → SAMPLE.
    const reg = await post(`/tournaments/${t.id}/registrations`, team.captain, {
      teamId: team.id,
      starters: [...team.members.slice(0, 4), sp.id],
      substitutes: [],
    }).expect(409);
    expect(reg.body.details).toEqual([{ field: sp.id, message: 'SAMPLE' }]);

    // (b) a sample team cannot register into a real tournament (even by SUPER_ADMIN).
    const st = await sampleTeam();
    const sreg = await post(`/tournaments/${t.id}/registrations`, admin, {
      teamId: st.id,
      starters: st.members.map((m) => m.id),
      substitutes: [],
    }).expect(409);
    expect(sreg.body.code).toBe('SAMPLE_RESOURCE');

    // (c) approval re-validation refuses a snapshot containing a sample player.
    const sneaky = await realTeam();
    const sneakyReg = await pendingRegistration(t.id, {
      id: sneaky.id,
      members: [
        ...(await db().user.findMany({
          where: { id: { in: sneaky.members.slice(0, 4) } },
          select: { id: true, steamId64: true },
        })),
        { id: sp.id, steamId64: sp.steamId64 },
      ],
    });
    const appr = await post(
      `/admin/tournaments/${t.id}/registrations/${sneakyReg.id}/approve`,
      admin,
    ).expect(409);
    expect(appr.body.details).toEqual([{ field: sp.id, message: 'SAMPLE' }]);

    // (d) substitution of a sample player into a locked real roster → SAMPLE.
    const ok = await post(`/tournaments/${t.id}/registrations`, team.captain, {
      teamId: team.id,
      starters: team.members.slice(0, 5),
      substitutes: [],
    }).expect(201);
    await post(`/admin/tournaments/${t.id}/registrations/${ok.body.id}/approve`, admin).expect(200);
    const sub = await post(
      `/admin/tournaments/${t.id}/registrations/${ok.body.id}/substitute`,
      admin,
      {
        outUserId: team.members[1],
        inUserId: sp.id,
        role: 'STARTER',
        reason: 'demo leak attempt',
      },
    ).expect(409);
    expect(sub.body.details).toEqual([{ field: sp.id, message: 'SAMPLE' }]);

    // (e) a sample match inside a real tournament stays immutable.
    const sm = await db().match.create({
      data: { tournamentId: t.id, teamAId: team.id, teamBId: sneaky.id, isSample: true },
    });
    const ff = await post(`/admin/matches/${sm.id}/forfeit`, admin, {
      forfeitingTeamId: team.id,
      reason: 'demo',
    }).expect(409);
    expect(ff.body.code).toBe('SAMPLE_RESOURCE');
  });

  it('M1/M2 sample guards are unchanged with the flag', async () => {
    const st = await sampleTeam();
    const invitee = await user();
    const inv = await post(`/teams/${st.id}/invitations`, admin, {
      steamId64: invitee.steamId64,
      role: 'PLAYER',
    }).expect(409);
    expect(inv.body.code).toBe('SAMPLE_RESOURCE');
    await post(`/admin/users/${st.members[0]!.id}/roles`, admin, {
      role: 'TOURNAMENT_ADMIN',
      scopeType: 'GLOBAL',
      reason: 'demo attempt',
    }).expect(409);
    const rm = await post(`/teams/${st.id}/members/${st.members[1]!.id}/remove`, admin, {
      reason: 'demo attempt',
    }).expect(409);
    expect(rm.body.code).toBe('SAMPLE_RESOURCE');
    expect(await db().teamMembership.count({ where: { teamId: st.id, leftAt: null } })).toBe(5);
  });
});

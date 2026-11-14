import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomToken, sha256Hex } from '../../src/auth/crypto.js';
import { SessionService } from '../../src/auth/session.service.js';
import { StubSteamProvider, testSteamId } from '../support/steam-stub.js';
import { createAuthTestApp, type LoggedIn, login, WEB } from './auth-helpers.js';
import { prismaOf, sampleSteamId, truncateAll } from './helpers.js';

type Who = LoggedIn & { id: string; steamId64: string };

/**
 * M2 teams, applications, invitations, rosters and idempotency against real PostgreSQL + Redis
 * (docs/TEAMS.md). Includes the mandatory concurrency cases (§11).
 */
describe('M2 teams API (real PostgreSQL + Redis)', () => {
  let app: NestExpressApplication;
  let op: StubSteamProvider;
  const adminSteamId = testSteamId();
  let admin: Who;
  let seq = 0;

  const db = () => prismaOf(app);
  const server = () => app.getHttpServer();

  async function user(steamId64 = testSteamId()): Promise<Who> {
    const session = await login(app, op, steamId64);
    const row = await db().user.findUniqueOrThrow({ where: { steamId64 } });
    return { ...session, id: row.id, steamId64 };
  }

  function post(
    path: string,
    who: LoggedIn | null,
    body?: object,
    headers: Record<string, string> = {},
  ) {
    let req = request(server()).post(`/api/v1${path}`).set('Origin', WEB);
    if (who) req = req.set('Cookie', who.cookie).set('x-csrf-token', who.csrf);
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return body === undefined ? req : req.send(body);
  }
  function get(path: string, who?: LoggedIn | null) {
    const req = request(server()).get(`/api/v1${path}`);
    return who ? req.set('Cookie', who.cookie) : req;
  }

  const uniq = () => {
    seq += 1;
    return `${Date.now().toString(36).slice(-4)}${seq}`;
  };
  let tagSeq = 0;
  /** Unique 5-char tags (Q + base36 counter); literal test tags are 4 chars, so no clash. */
  const newTag = () => `Q${(tagSeq++).toString(36).toUpperCase().padStart(4, '0')}`;

  async function apply(who: Who, name = `Team ${uniq()}`, tag?: string) {
    const res = await post('/team-applications', who, {
      name,
      tag: tag ?? newTag(),
    }).expect(201);
    return res.body as { id: string; slug: string; name: string; tag: string };
  }

  async function makeTeam(captain?: Who) {
    const cap = captain ?? (await user());
    const appl = await apply(cap);
    const res = await post(`/admin/team-applications/${appl.id}/approve`, admin, {}).expect(200);
    const team = res.body.createdTeam as { id: string; slug: string; name: string };
    return { ...team, captain: cap };
  }

  async function invite(teamId: string, by: Who, invitee: Who, role = 'PLAYER') {
    const res = await post(`/teams/${teamId}/invitations`, by, {
      steamId64: invitee.steamId64,
      role,
    }).expect(201);
    return res.body as { id: string };
  }

  async function addMember(teamId: string, by: Who, member?: Who, role = 'PLAYER') {
    const m = member ?? (await user());
    const inv = await invite(teamId, by, m, role);
    await post(`/invitations/${inv.id}/accept`, m).expect(200);
    return m;
  }

  async function auditCount(action: string, resourceId?: string) {
    return db().auditLog.count({ where: { action, ...(resourceId ? { resourceId } : {}) } });
  }

  beforeAll(async () => {
    ({ app, op } = await createAuthTestApp({ BOOTSTRAP_SUPER_ADMIN_STEAM_ID64: adminSteamId }));
    // Listen once: otherwise supertest calls listen()/close() on the same http.Server for every
    // request, and the many parallel requests of the concurrency tests race on it (observed as
    // sporadic native worker crashes on Windows).
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

  describe('session / CSRF / CORS spot checks', () => {
    it('anonymous → 401 and missing CSRF → 403 on new unsafe endpoints', async () => {
      const id = randomUUID();
      for (const path of [
        '/team-applications',
        `/team-applications/${id}/withdraw`,
        `/admin/team-applications/${id}/approve`,
        `/teams/${id}/invitations`,
        `/teams/${id}/leave`,
        `/teams/${id}/transfer-captain`,
        `/invitations/${id}/accept`,
      ]) {
        const anon = await post(path, null, {}).expect(401);
        expect(anon.body.code).toBe('UNAUTHENTICATED');
      }
      const someone = await user();
      const noCsrf = await request(server())
        .post(`/api/v1/invitations/${id}/accept`)
        .set('Cookie', someone.cookie)
        .set('Origin', WEB)
        .expect(403);
      expect(noCsrf.body.code).toBe('CSRF_FAILED');
      const badOrigin = await request(server())
        .post('/api/v1/team-applications')
        .set('Cookie', someone.cookie)
        .set('x-csrf-token', someone.csrf)
        .set('Origin', 'https://evil.example')
        .send({ name: 'Evil Team', tag: 'EVIL' })
        .expect(403);
      expect(badOrigin.body.code).toBe('CSRF_FAILED');
      expect(await db().teamApplication.count({ where: { requestedName: 'Evil Team' } })).toBe(0);
    });

    it('CORS exposes Retry-After and Idempotency-Replayed to the web origin', async () => {
      const res = await request(server()).get('/api/v1/meta').set('Origin', WEB).expect(200);
      const exposed = String(res.headers['access-control-expose-headers']).toLowerCase();
      expect(exposed).toContain('x-request-id');
      expect(exposed).toContain('retry-after');
      expect(exposed).toContain('idempotency-replayed');
    });
  });

  describe('applications', () => {
    it('validation errors → 400 VALIDATION_FAILED', async () => {
      const u = await user();
      for (const body of [
        {},
        { name: 'ab', tag: 'OK' },
        { name: 'Fine Name', tag: 'TOOLONGTAG' },
        { name: 'Fine Name', tag: 'OK', extra: 1 },
        { name: 'Fine Name', tag: 'OK', countryCode: 'XX' },
      ]) {
        const res = await post('/team-applications', u, body).expect(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      }
    });

    it('submit, list own, duplicate pending, name/tag clashes, withdraw ownership', async () => {
      const a = await user();
      const b = await user();
      const name = `Steppe Wolves ${uniq()}`;
      const created = await post('/team-applications', a, {
        name: `  ${name} `,
        tag: 'swlv',
        countryCode: 'KZ',
        description: 'We play.\nA lot.',
      }).expect(201);
      expect(created.body).toMatchObject({
        name,
        tag: 'swlv',
        countryCode: 'KZ',
        status: 'PENDING',
        reviewReason: null,
        reviewedAt: null,
        createdTeam: null,
      });
      expect(created.body.slug).toMatch(/^steppe-wolves-/);
      expect(await auditCount('team_application.submit', created.body.id)).toBe(1);

      const mine = await get('/me/team-applications', a).expect(200);
      expect(mine.body.map((x: { id: string }) => x.id)).toEqual([created.body.id]);
      expect((await get('/me/team-applications', b).expect(200)).body).toEqual([]);

      const dup = await post('/team-applications', a, { name: 'Other Name', tag: 'OTHR' });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('APPLICATION_ALREADY_PENDING');
      const nameClash = await post('/team-applications', b, {
        name: name.toUpperCase(),
        tag: 'ZZZZ',
      }).expect(409);
      expect(nameClash.body.code).toBe('TEAM_NAME_TAKEN');
      const tagClash = await post('/team-applications', b, {
        name: `Unique ${uniq()}`,
        tag: 'SWLV',
      }).expect(409);
      expect(tagClash.body.code).toBe('TEAM_TAG_TAKEN');

      const foreign = await post(`/team-applications/${created.body.id}/withdraw`, b).expect(404);
      expect(foreign.body.code).toBeUndefined();
      const withdrawn = await post(`/team-applications/${created.body.id}/withdraw`, a).expect(200);
      expect(withdrawn.body.status).toBe('WITHDRAWN');
      const again = await post(`/team-applications/${created.body.id}/withdraw`, a).expect(409);
      expect(again.body.code).toBe('APPLICATION_NOT_PENDING');
      // After withdrawal the name is free again.
      await post('/team-applications', b, { name, tag: 'SWLV' }).expect(201);
    });

    it('same slug base from different names gets a suffixed requested slug', async () => {
      const s = uniq();
      const one = await apply(await user(), `Slug Base ${s}`);
      const two = await apply(await user(), `Slug-Base.${s}`);
      expect(one.slug).toBe(`slug-base-${s}`);
      expect(two.slug).toBe(`slug-base-${s}-2`);
    });

    it('non-admin cannot list/approve/reject', async () => {
      const u = await user();
      const appl = await apply(u);
      expect((await get('/admin/team-applications', u).expect(403)).body.code).toBe(
        'FORBIDDEN_ROLE',
      );
      await post(`/admin/team-applications/${appl.id}/approve`, u, {}).expect(403);
      await post(`/admin/team-applications/${appl.id}/reject`, u, { reason: 'nope' }).expect(403);
    });

    it('two (five) concurrent approvals ⇒ exactly one team, one captain, one approve audit', async () => {
      const applicant = await user();
      const appl = await apply(applicant);
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          post(`/admin/team-applications/${appl.id}/approve`, admin, {}),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409, 409, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.code).toBe('APPLICATION_NOT_PENDING');
      }
      const ok = results.find((r) => r.status === 200)!;
      expect(ok.body.status).toBe('APPROVED');
      const teamId = ok.body.createdTeam.id as string;
      expect(await db().team.count({ where: { name: appl.name } })).toBe(1);
      expect(
        await db().teamMembership.count({ where: { teamId, role: 'CAPTAIN', leftAt: null } }),
      ).toBe(1);
      expect(await auditCount('team_application.approve', appl.id)).toBe(1);
      expect(await auditCount('team.create', teamId)).toBe(1);
      expect(await auditCount('team_membership.join')).toBeGreaterThanOrEqual(1);

      const me = await get('/me', applicant).expect(200);
      expect(me.body.membership).toMatchObject({ teamId, role: 'CAPTAIN' });
      // In a team now: cannot apply again.
      const inTeam = await post('/team-applications', applicant, {
        name: `Another ${uniq()}`,
        tag: 'ANTH',
      }).expect(409);
      expect(inTeam.body.code).toBe('APPLICANT_IN_TEAM');

      const team = await get(`/teams/${ok.body.createdTeam.slug}`).expect(200);
      expect(team.body.roster).toEqual([
        expect.objectContaining({ userId: applicant.id, role: 'CAPTAIN' }),
      ]);
    });

    it('reject requires a reason; the reason is visible to the applicant', async () => {
      const u = await user();
      const appl = await apply(u);
      const bad = await post(`/admin/team-applications/${appl.id}/reject`, admin, {}).expect(400);
      expect(bad.body.code).toBe('VALIDATION_FAILED');
      await post(`/admin/team-applications/${appl.id}/reject`, admin, { reason: ' x ' }).expect(
        400,
      );
      const rejected = await post(`/admin/team-applications/${appl.id}/reject`, admin, {
        reason: 'Name violates the rules',
      }).expect(200);
      expect(rejected.body).toMatchObject({
        status: 'REJECTED',
        reviewReason: 'Name violates the rules',
      });
      const mine = await get('/me/team-applications', u).expect(200);
      expect(mine.body[0]).toMatchObject({
        status: 'REJECTED',
        reviewReason: 'Name violates the rules',
      });
      expect(mine.body[0].reviewedAt).toEqual(expect.any(String));
      const twice = await post(`/admin/team-applications/${appl.id}/approve`, admin, {}).expect(
        409,
      );
      expect(twice.body.code).toBe('APPLICATION_NOT_PENDING');
      expect(await auditCount('team_application.reject', appl.id)).toBe(1);
    });

    it('name / tag taken at approval → 409, application stays PENDING', async () => {
      const u1 = await user();
      const s = uniq();
      const appl1 = await apply(u1, `Taken Name ${s}`, newTag());
      await db().team.create({
        data: { slug: `taken-name-x${s}`, name: `taken name ${s}`, tag: newTag() },
      });
      const r1 = await post(`/admin/team-applications/${appl1.id}/approve`, admin, {}).expect(409);
      expect(r1.body.code).toBe('TEAM_NAME_TAKEN');

      const u2 = await user();
      const s2 = uniq();
      const tag = newTag();
      const appl2 = await apply(u2, `Tag Clash ${s2}`, tag);
      await db().team.create({
        data: { slug: `tag-clash-x${s2}`, name: `Other ${s2}`, tag: tag.toLowerCase() },
      });
      const r2 = await post(`/admin/team-applications/${appl2.id}/approve`, admin, {}).expect(409);
      expect(r2.body.code).toBe('TEAM_TAG_TAKEN');
      expect(
        (await db().teamApplication.findUniqueOrThrow({ where: { id: appl2.id } })).status,
      ).toBe('PENDING');
    });

    it('suspended applicant → APPLICANT_INELIGIBLE at approval', async () => {
      const u = await user();
      const appl = await apply(u);
      await db().user.update({ where: { id: u.id }, data: { status: 'SUSPENDED' } });
      const res = await post(`/admin/team-applications/${appl.id}/approve`, admin, {}).expect(409);
      expect(res.body.code).toBe('APPLICANT_INELIGIBLE');
    });

    it('sample user → 409 SAMPLE_RESOURCE', async () => {
      // Sample accounts can never sign in through Steam; craft a session directly.
      const sample = await db().user.create({
        data: {
          steamId64: sampleSteamId(),
          isSample: true,
          playerProfile: { create: { nickname: 'sample', slug: `sample-${uniq()}` } },
        },
      });
      const token = randomToken();
      const session = await db().authSession.create({
        data: {
          userId: sample.id,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + 3600_000),
          lastSeenAt: new Date(),
        },
      });
      const csrf = app.get(SessionService).csrfTokenFor(session.id)!;
      const who = { cookie: `rage_session=${token}; rage_csrf=${csrf}`, csrf } as LoggedIn;
      const res = await post('/team-applications', who, {
        name: `Sample ${uniq()}`,
        tag: 'SMPL',
      }).expect(409);
      expect(res.body.code).toBe('SAMPLE_RESOURCE');
    });

    it('admin queue: default PENDING oldest first, status filter, page shape', async () => {
      const res = await get('/admin/team-applications?pageSize=100', admin).expect(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 100, total: expect.any(Number) });
      const items = res.body.items as { status: string; createdAt: string; applicant: object }[];
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.status === 'PENDING')).toBe(true);
      const times = items.map((i) => i.createdAt);
      expect([...times].sort()).toEqual(times);
      expect(items[0]!.applicant).toEqual({
        userId: expect.any(String),
        steamId64: expect.stringMatching(/^\d{17}$/),
        nickname: expect.any(String),
        playerSlug: expect.any(String),
      });
      const rejected = await get('/admin/team-applications?status=REJECTED', admin).expect(200);
      expect(rejected.body.items.every((i: { status: string }) => i.status === 'REJECTED')).toBe(
        true,
      );
      expect(rejected.body.items[0].reviewedById).toBe(admin.id);
      await get('/admin/team-applications?status=BOGUS', admin).expect(400);
    });

    it('POST /teams no longer exists: teams come only from approved applications (gate M-1)', async () => {
      const cap = await user();
      await post('/teams', admin, {
        name: `Direct ${uniq()}`,
        tag: newTag(),
        captainUserId: cap.id,
        reason: 'should not exist',
      }).expect(404);
      expect(await db().teamMembership.count({ where: { userId: cap.id } })).toBe(0);
    });

    it('per-applicant quota: at most 5 submissions per rolling 24 h → 409 APPLICATION_LIMIT', async () => {
      const u = await user();
      for (let i = 0; i < 5; i++) {
        const appl = await apply(u);
        await post(`/team-applications/${appl.id}/withdraw`, u).expect(200);
      }
      const res = await post('/team-applications', u, {
        name: `Quota ${uniq()}`,
        tag: newTag(),
      }).expect(409);
      expect(res.body.code).toBe('APPLICATION_LIMIT');
      // Outside the rolling window the quota frees up again.
      await db().teamApplication.updateMany({
        where: { applicantUserId: u.id },
        data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
      });
      await apply(u);
    });

    it('sample applications cannot be rejected (409 SAMPLE_RESOURCE) and are flagged isSample', async () => {
      const sampleUser = await db().user.create({
        data: {
          steamId64: sampleSteamId(),
          isSample: true,
          playerProfile: { create: { nickname: 'sample-app', slug: `sample-app-${uniq()}` } },
        },
      });
      const s = uniq();
      const appl = await db().teamApplication.create({
        data: {
          applicantUserId: sampleUser.id,
          requestedName: `Sample App ${s}`,
          requestedTag: newTag(),
          requestedSlug: `sample-app-${s}`,
        },
      });
      const res = await post(`/admin/team-applications/${appl.id}/reject`, admin, {
        reason: 'demo data',
      }).expect(409);
      expect(res.body.code).toBe('SAMPLE_RESOURCE');
      const list = await get('/admin/team-applications?pageSize=100', admin).expect(200);
      const items = list.body.items as { id: string; isSample: boolean }[];
      expect(items.find((i) => i.id === appl.id)?.isSample).toBe(true);
      expect(items.filter((i) => i.id !== appl.id).every((i) => i.isSample === false)).toBe(true);
    });
  });

  describe('invitations', () => {
    it('invite rules: unknown/sample SteamID 404 (no user created), non-operator 403, member, duplicate', async () => {
      const team = await makeTeam();
      const usersBefore = await db().user.count();
      const unknown = await post(`/teams/${team.id}/invitations`, team.captain, {
        steamId64: testSteamId(),
        role: 'PLAYER',
      }).expect(404);
      expect(unknown.body.code).toBe('PLAYER_NOT_FOUND');
      const sample = await db().user.create({
        data: { steamId64: sampleSteamId(), isSample: true },
      });
      const sampleRes = await post(`/teams/${team.id}/invitations`, team.captain, {
        steamId64: sample.steamId64,
        role: 'PLAYER',
      }).expect(404);
      expect(sampleRes.body.code).toBe('PLAYER_NOT_FOUND');
      expect(await db().user.count()).toBe(usersBefore + 1); // only the sample row we inserted

      const outsider = await user();
      const target = await user();
      const forbidden = await post(`/teams/${team.id}/invitations`, outsider, {
        steamId64: target.steamId64,
        role: 'PLAYER',
      }).expect(403);
      expect(forbidden.body.code).toBe('FORBIDDEN_ROLE');
      await post(`/teams/${team.id}/invitations`, team.captain, {
        steamId64: target.steamId64,
        role: 'COACH',
      }).expect(400);

      const self = await post(`/teams/${team.id}/invitations`, team.captain, {
        steamId64: team.captain.steamId64,
        role: 'PLAYER',
      }).expect(409);
      expect(self.body.code).toBe('ALREADY_MEMBER');

      const inv = await post(`/teams/${team.id}/invitations`, team.captain, {
        steamId64: target.steamId64,
        role: 'SUBSTITUTE',
      }).expect(201);
      expect(inv.body).toMatchObject({
        status: 'PENDING',
        role: 'SUBSTITUTE',
        respondedAt: null,
        invitee: { userId: target.id, steamId64: target.steamId64 },
        invitedBy: { userId: team.captain.id },
      });
      const ttl = Date.parse(inv.body.expiresAt) - Date.parse(inv.body.createdAt);
      expect(ttl).toBe(7 * 24 * 3600_000);
      const dup = await post(`/teams/${team.id}/invitations`, team.captain, {
        steamId64: target.steamId64,
        role: 'PLAYER',
      }).expect(409);
      expect(dup.body.code).toBe('INVITATION_ALREADY_PENDING');

      const mine = await get('/me/invitations', target).expect(200);
      expect(mine.body).toEqual([
        expect.objectContaining({
          id: inv.body.id,
          team: { id: team.id, slug: team.slug, name: team.name, tag: expect.any(String) },
          invitedBy: { nickname: expect.any(String) },
        }),
      ]);
      await post(`/invitations/${inv.body.id}/accept`, target).expect(200);
      const member = await post(`/teams/${team.id}/invitations`, team.captain, {
        steamId64: target.steamId64,
        role: 'PLAYER',
      }).expect(409);
      expect(member.body.code).toBe('ALREADY_MEMBER');
      await get(`/me/invitations?status=NOPE`, target).expect(400);
    });

    it('only the invitee can accept/decline (others 404); decline is listed in history', async () => {
      const team = await makeTeam();
      const invitee = await user();
      const other = await user();
      const inv = await invite(team.id, team.captain, invitee);
      for (const who of [other, team.captain, admin]) {
        await post(`/invitations/${inv.id}/accept`, who).expect(404);
        await post(`/invitations/${inv.id}/decline`, who).expect(404);
      }
      await post(`/invitations/${randomUUID()}/accept`, invitee).expect(404);
      const declined = await post(`/invitations/${inv.id}/decline`, invitee).expect(200);
      expect(declined.body).toMatchObject({ status: 'DECLINED', respondedAt: expect.any(String) });
      const again = await post(`/invitations/${inv.id}/accept`, invitee).expect(409);
      expect(again.body.code).toBe('INVITATION_NOT_PENDING');
      expect((await get('/me/invitations', invitee).expect(200)).body).toEqual([]);
      const history = await get('/me/invitations?status=DECLINED', invitee).expect(200);
      expect(history.body.map((i: { id: string }) => i.id)).toEqual([inv.id]);
      expect(await auditCount('team_invitation.decline', inv.id)).toBe(1);
    });

    it('expired invitation → 409 INVITATION_EXPIRED and EXPIRED is persisted', async () => {
      const team = await makeTeam();
      const invitee = await user();
      const inv = await invite(team.id, team.captain, invitee);
      const past = Date.now() - 3600_000;
      await db().teamInvitation.update({
        where: { id: inv.id },
        data: { createdAt: new Date(past - 8 * 24 * 3600_000), expiresAt: new Date(past) },
      });
      const res = await post(`/invitations/${inv.id}/accept`, invitee).expect(409);
      expect(res.body.code).toBe('INVITATION_EXPIRED');
      const row = await db().teamInvitation.findUniqueOrThrow({ where: { id: inv.id } });
      expect(row.status).toBe('EXPIRED');
      expect(row.respondedAt?.getTime()).toBe(past);
      expect(await auditCount('team_invitation.expire', inv.id)).toBe(1);
      expect(await db().teamMembership.count({ where: { userId: invitee.id } })).toBe(0);
      const later = await post(`/invitations/${inv.id}/accept`, invitee).expect(409);
      expect(later.body.code).toBe('INVITATION_NOT_PENDING');

      // Lazy expiry on read: another stale invitation disappears from PENDING lists.
      const inv2 = await invite(team.id, team.captain, invitee);
      await db().teamInvitation.update({
        where: { id: inv2.id },
        data: { createdAt: new Date(past - 8 * 24 * 3600_000), expiresAt: new Date(past) },
      });
      expect((await get('/me/invitations', invitee).expect(200)).body).toEqual([]);
      expect((await db().teamInvitation.findUniqueOrThrow({ where: { id: inv2.id } })).status).toBe(
        'EXPIRED',
      );
      const expiredList = await get('/me/invitations?status=EXPIRED', invitee).expect(200);
      expect(expiredList.body).toHaveLength(2);
    });

    it('revoke then accept → 409; revoke is operator-only and audited', async () => {
      const team = await makeTeam();
      const invitee = await user();
      const inv = await invite(team.id, team.captain, invitee);
      await post(`/teams/${team.id}/invitations/${inv.id}/revoke`, invitee, {}).expect(403);
      const other = await makeTeam();
      await post(`/teams/${other.id}/invitations/${inv.id}/revoke`, other.captain, {}).expect(404);
      const revoked = await post(`/teams/${team.id}/invitations/${inv.id}/revoke`, team.captain, {
        reason: 'changed our mind',
      }).expect(200);
      expect(revoked.body.status).toBe('REVOKED');
      const res = await post(`/invitations/${inv.id}/accept`, invitee).expect(409);
      expect(res.body.code).toBe('INVITATION_NOT_PENDING');
      const again = await post(`/teams/${team.id}/invitations/${inv.id}/revoke`, team.captain, {});
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('INVITATION_NOT_PENDING');
      expect(await auditCount('team_invitation.revoke', inv.id)).toBe(1);
    });

    it('pending invitation cap is 10 per team', async () => {
      const team = await makeTeam();
      for (let i = 0; i < 10; i++) await invite(team.id, team.captain, await user());
      const res = await post(`/teams/${team.id}/invitations`, team.captain, {
        steamId64: (await user()).steamId64,
        role: 'PLAYER',
      }).expect(409);
      expect(res.body.code).toBe('INVITATION_LIMIT');
      const manage = await get(`/teams/${team.slug}/manage`, team.captain).expect(200);
      expect(manage.body.pendingInvitations).toHaveLength(10);
      expect(manage.body).toMatchObject({ rosterCap: 7, pendingInvitationCap: 10 });
    });

    it('concurrent accepts by two users into the last roster slot ⇒ exactly one', async () => {
      const team = await makeTeam();
      for (let i = 0; i < 5; i++) await addMember(team.id, team.captain);
      const u1 = await user();
      const u2 = await user();
      const i1 = await invite(team.id, team.captain, u1, 'SUBSTITUTE');
      const i2 = await invite(team.id, team.captain, u2, 'SUBSTITUTE');
      const [r1, r2] = await Promise.all([
        post(`/invitations/${i1.id}/accept`, u1),
        post(`/invitations/${i2.id}/accept`, u2),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      expect([r1, r2].find((r) => r.status === 409)!.body.code).toBe('ROSTER_FULL');
      expect(await db().teamMembership.count({ where: { teamId: team.id, leftAt: null } })).toBe(7);
      const late = await user();
      const i3 = await invite(team.id, team.captain, late);
      expect((await post(`/invitations/${i3.id}/accept`, late).expect(409)).body.code).toBe(
        'ROSTER_FULL',
      );
    });

    it('one user accepting two teams concurrently ⇒ one membership', async () => {
      const t1 = await makeTeam();
      const t2 = await makeTeam();
      const u = await user();
      const a = await invite(t1.id, t1.captain, u);
      const b = await invite(t2.id, t2.captain, u);
      const [r1, r2] = await Promise.all([
        post(`/invitations/${a.id}/accept`, u),
        post(`/invitations/${b.id}/accept`, u),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      expect([r1, r2].find((r) => r.status === 409)!.body.code).toBe('ALREADY_IN_TEAM');
      expect(await db().teamMembership.count({ where: { userId: u.id, leftAt: null } })).toBe(1);
      const me = await get('/me', u).expect(200);
      expect([t1.id, t2.id]).toContain(me.body.membership.teamId);
    });

    it('accept vs revoke race is serialized (membership iff ACCEPTED)', async () => {
      const team = await makeTeam();
      for (let round = 0; round < 3; round++) {
        const u = await user();
        const inv = await invite(team.id, team.captain, u);
        const [acc, rev] = await Promise.all([
          post(`/invitations/${inv.id}/accept`, u),
          post(`/teams/${team.id}/invitations/${inv.id}/revoke`, team.captain, {}),
        ]);
        expect([acc.status, rev.status].sort()).toEqual([200, 409]);
        const loser = acc.status === 409 ? acc : rev;
        expect(loser.body.code).toBe('INVITATION_NOT_PENDING');
        const row = await db().teamInvitation.findUniqueOrThrow({ where: { id: inv.id } });
        const memberships = await db().teamMembership.count({ where: { invitationId: inv.id } });
        expect(row.status === 'ACCEPTED').toBe(memberships === 1);
        expect(['ACCEPTED', 'REVOKED']).toContain(row.status);
        if (row.status === 'ACCEPTED') {
          await post(`/teams/${team.id}/leave`, u).expect(204);
        }
      }
    });

    it('TEAM_MANAGER grant can invite/remove players but cannot transfer or remove the captain', async () => {
      const team = await makeTeam();
      const player = await addMember(team.id, team.captain);
      const manager = await user();
      await post(`/admin/users/${manager.id}/roles`, admin, {
        role: 'TEAM_MANAGER',
        scopeType: 'TEAM',
        scopeId: team.id,
        reason: 'team manager',
      }).expect(201);
      const view = await get(`/teams/${team.slug}/manage`, manager).expect(200);
      expect(view.body.permissions).toEqual({
        canInvite: true,
        canRemove: true,
        canTransfer: false,
      });
      expect(view.body.team.roster.map((r: { userId: string }) => r.userId).sort()).toEqual(
        [team.captain.id, player.id].sort(),
      );
      await invite(team.id, manager, await user());
      const transfer = await post(`/teams/${team.id}/transfer-captain`, manager, {
        newCaptainUserId: player.id,
      }).expect(403);
      expect(transfer.body.code).toBe('FORBIDDEN_ROLE');
      const removeCaptain = await post(
        `/teams/${team.id}/members/${team.captain.id}/remove`,
        manager,
        { reason: 'coup attempt' },
      ).expect(409);
      expect(removeCaptain.body.code).toBe('CAPTAIN_MUST_TRANSFER');
      await post(`/teams/${team.id}/members/${player.id}/remove`, manager, {
        reason: 'inactive',
      }).expect(204);
      // Manager of another team has no authority here.
      const otherTeam = await makeTeam();
      await get(`/teams/${otherTeam.slug}/manage`, manager).expect(403);
      await get(`/teams/${otherTeam.slug}/manage`, player).expect(403);
      await get(`/teams/${otherTeam.slug}/manage`).expect(401);
    });

    it('SUPER_ADMIN override on someone else’s team is audited with override: true', async () => {
      const team = await makeTeam();
      const u = await user();
      const inv = await invite(team.id, admin, u);
      const audit = await db().auditLog.findFirstOrThrow({
        where: { action: 'team_invitation.create', resourceId: inv.id },
      });
      expect(audit.actorUserId).toBe(admin.id);
      expect(audit.detailJson).toMatchObject({ override: true, teamId: team.id });
      const capInv = await invite(team.id, team.captain, await user());
      const capAudit = await db().auditLog.findFirstOrThrow({
        where: { action: 'team_invitation.create', resourceId: capInv.id },
      });
      expect(capAudit.detailJson).not.toHaveProperty('override');
      const view = await get(`/teams/${team.slug}/manage`, admin).expect(200);
      expect(view.body.permissions.canTransfer).toBe(true);
    });

    it('re-invite cooldown: 24 h after a DECLINED or REVOKED invitation → 409 INVITATION_COOLDOWN', async () => {
      const team = await makeTeam();
      const u = await user();
      const i1 = await invite(team.id, team.captain, u);
      await post(`/invitations/${i1.id}/decline`, u).expect(200);
      const again = await post(`/teams/${team.id}/invitations`, team.captain, {
        steamId64: u.steamId64,
        role: 'PLAYER',
      }).expect(409);
      expect(again.body.code).toBe('INVITATION_COOLDOWN');
      const v = await user();
      const i2 = await invite(team.id, team.captain, v);
      await post(`/teams/${team.id}/invitations/${i2.id}/revoke`, team.captain, {}).expect(200);
      const revoked = await post(`/teams/${team.id}/invitations`, admin, {
        steamId64: v.steamId64,
        role: 'PLAYER',
      }).expect(409);
      expect(revoked.body.code).toBe('INVITATION_COOLDOWN');
      // Other teams are unaffected; after 24 h the same team may invite again.
      const other = await makeTeam();
      await invite(other.id, other.captain, u);
      await db().teamInvitation.update({
        where: { id: i1.id },
        data: { respondedAt: new Date(Date.now() - 25 * 3600_000) },
      });
      await invite(team.id, team.captain, u);
    });

    it('the same invitation accepted twice in parallel ⇒ [200, 409], one membership, one audit', async () => {
      const team = await makeTeam();
      const u = await user();
      const inv = await invite(team.id, team.captain, u);
      const results = await Promise.all([
        post(`/invitations/${inv.id}/accept`, u),
        post(`/invitations/${inv.id}/accept`, u),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.body.code).toBe('INVITATION_NOT_PENDING');
      expect(await db().teamMembership.count({ where: { userId: u.id } })).toBe(1);
      expect(await auditCount('team_invitation.accept', inv.id)).toBe(1);
    });

    it('concurrent invites at the pending cap ⇒ exactly one more invitation', async () => {
      const team = await makeTeam();
      for (let i = 0; i < 9; i++) await invite(team.id, team.captain, await user());
      const invitees = [await user(), await user(), await user()];
      const results = await Promise.all(
        invitees.map((u) =>
          post(`/teams/${team.id}/invitations`, team.captain, {
            steamId64: u.steamId64,
            role: 'PLAYER',
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.code).toBe('INVITATION_LIMIT');
      }
      expect(
        await db().teamInvitation.count({ where: { teamId: team.id, status: 'PENDING' } }),
      ).toBe(10);
    });

    it('grant revocation racing operator actions never yields 5xx (lock order, gate L-1)', async () => {
      const otherAdmin = await user();
      await post(`/admin/users/${otherAdmin.id}/roles`, admin, {
        role: 'SUPER_ADMIN',
        scopeType: 'GLOBAL',
        reason: 'second admin',
      }).expect(201);
      for (let round = 0; round < 3; round++) {
        const team = await makeTeam();
        const saManager = await user();
        const manager = await user();
        await post(`/admin/users/${saManager.id}/roles`, admin, {
          role: 'SUPER_ADMIN',
          scopeType: 'GLOBAL',
          reason: 'sa manager',
        }).expect(201);
        const grants: Record<string, string> = {};
        for (const m of [saManager, manager]) {
          const g = await post(`/admin/users/${m.id}/roles`, admin, {
            role: 'TEAM_MANAGER',
            scopeType: 'TEAM',
            scopeId: team.id,
            reason: 'team manager',
          }).expect(201);
          grants[m.id] = g.body.id as string;
        }
        const targets = [await user(), await user(), await user()];
        const [i1, i2, r1, i3, r2] = await Promise.all([
          post(`/teams/${team.id}/invitations`, saManager, {
            steamId64: targets[0]!.steamId64,
            role: 'PLAYER',
          }),
          post(`/teams/${team.id}/invitations`, manager, {
            steamId64: targets[1]!.steamId64,
            role: 'PLAYER',
          }),
          post(`/admin/users/${saManager.id}/roles/${grants[saManager.id]}/revoke`, otherAdmin, {
            reason: 'race revoke',
          }),
          post(`/teams/${team.id}/invitations`, saManager, {
            steamId64: targets[2]!.steamId64,
            role: 'SUBSTITUTE',
          }),
          post(`/admin/users/${manager.id}/roles/${grants[manager.id]}/revoke`, otherAdmin, {
            reason: 'race revoke',
          }),
        ]);
        for (const r of [i1, i2, r1, i3, r2]) expect(r.status).toBeLessThan(500);
        expect(i1.status).toBe(201); // still SUPER_ADMIN
        expect(i3.status).toBe(201);
        expect([201, 403]).toContain(i2.status);
        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        // After revocation the plain manager has no authority left.
        await post(`/teams/${team.id}/invitations`, manager, {
          steamId64: (await user()).steamId64,
          role: 'PLAYER',
        }).expect(403);
      }
    });

    it('sample teams are never mutated (409 SAMPLE_RESOURCE)', async () => {
      const sampleTeam = await db().team.create({
        data: { slug: `sample-${uniq()}`, name: `Sample ${uniq()}`, tag: 'SMP', isSample: true },
      });
      const u = await user();
      const res = await post(`/teams/${sampleTeam.id}/invitations`, admin, {
        steamId64: u.steamId64,
        role: 'PLAYER',
      }).expect(409);
      expect(res.body.code).toBe('SAMPLE_RESOURCE');
    });
  });

  describe('members', () => {
    it('leave/remove rules and public roster history without free-text reasons', async () => {
      const team = await makeTeam();
      const p1 = await addMember(team.id, team.captain);
      const p2 = await addMember(team.id, team.captain, undefined, 'SUBSTITUTE');
      const capLeave = await post(`/teams/${team.id}/leave`, team.captain).expect(409);
      expect(capLeave.body.code).toBe('CAPTAIN_MUST_TRANSFER');
      const capRemove = await post(`/teams/${team.id}/members/${team.captain.id}/remove`, admin, {
        reason: 'admin tries',
      }).expect(409);
      expect(capRemove.body.code).toBe('CAPTAIN_MUST_TRANSFER');
      await post(`/teams/${team.id}/members/${p2.id}/remove`, team.captain, {}).expect(400);
      await post(`/teams/${team.id}/members/${p2.id}/remove`, p1, {
        reason: 'not an operator',
      }).expect(403);

      await post(`/teams/${team.id}/leave`, p1).expect(204);
      const leftAgain = await post(`/teams/${team.id}/leave`, p1).expect(404);
      expect(leftAgain.body.code).toBe('NOT_TEAM_MEMBER');
      const secret = 'toxic behaviour in voice chat';
      await post(`/teams/${team.id}/members/${p2.id}/remove`, team.captain, {
        reason: secret,
      }).expect(204);
      const notMember = await post(`/teams/${team.id}/members/${p2.id}/remove`, team.captain, {
        reason: 'again',
      }).expect(404);
      expect(notMember.body.code).toBe('NOT_TEAM_MEMBER');
      expect((await get('/me', p1).expect(200)).body.membership).toBeNull();

      const history = await get(`/teams/${team.slug}/roster-history`).expect(200);
      expect(history.body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
      expect(JSON.stringify(history.body)).not.toContain(secret);
      const bySlug = Object.fromEntries(
        history.body.items.map((e: { playerSlug: string }) => [e.playerSlug, e]),
      );
      const p1Slug = (await db().playerProfile.findUniqueOrThrow({ where: { userId: p1.id } }))
        .slug;
      const p2Slug = (await db().playerProfile.findUniqueOrThrow({ where: { userId: p2.id } }))
        .slug;
      expect(bySlug[p1Slug]).toMatchObject({ role: 'PLAYER', leftReason: 'left' });
      expect(bySlug[p2Slug]).toMatchObject({ role: 'SUBSTITUTE', leftReason: 'removed' });
      expect(bySlug[p1Slug].leftAt).toEqual(expect.any(String));
      const removeAudit = await db().auditLog.findFirstOrThrow({
        where: { action: 'team_membership.remove', actorUserId: team.captain.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(removeAudit.detailJson).toMatchObject({ reason: secret, userId: p2.id });
      expect(await auditCount('team_membership.leave')).toBeGreaterThanOrEqual(1);
    });

    it('a sole captain can leave: team disbanded, pending invitations revoked, can join elsewhere', async () => {
      const lonely = await makeTeam();
      const other = await makeTeam();
      // Pending invitation FROM the lonely team (must be revoked on disband) …
      const outsider = await user();
      const outgoing = await post(`/teams/${lonely.id}/invitations`, lonely.captain, {
        steamId64: outsider.steamId64,
        role: 'PLAYER',
      }).expect(201);
      // … and one TO the lonely captain from another team.
      const incoming = await post(`/teams/${other.id}/invitations`, other.captain, {
        steamId64: lonely.captain.steamId64,
        role: 'PLAYER',
      }).expect(201);
      const blocked = await post(`/invitations/${incoming.body.id}/accept`, lonely.captain).expect(
        409,
      );
      expect(blocked.body.code).toBe('ALREADY_IN_TEAM');

      await post(`/teams/${lonely.id}/leave`, lonely.captain).expect(204);
      const team = await db().team.findUniqueOrThrow({ where: { id: lonely.id } });
      expect(team.status).toBe('DISBANDED');
      expect(
        await db().teamInvitation.findUniqueOrThrow({ where: { id: outgoing.body.id } }),
      ).toMatchObject({ status: 'REVOKED' });
      expect(await db().teamMembership.count({ where: { teamId: lonely.id, leftAt: null } })).toBe(
        0,
      );
      expect(
        await db().auditLog.count({ where: { action: 'team.disband', resourceId: lonely.id } }),
      ).toBe(1);

      await post(`/invitations/${incoming.body.id}/accept`, lonely.captain).expect(200);
      expect((await get('/me', lonely.captain).expect(200)).body.membership).toMatchObject({
        teamId: other.id,
        role: 'PLAYER',
      });
      // The disbanded team accepts no new invitations.
      const dead = await post(`/teams/${lonely.id}/invitations`, admin, {
        steamId64: outsider.steamId64,
        role: 'PLAYER',
      }).expect(409);
      expect(['TEAM_NOT_ACTIVE', 'INVITATION_COOLDOWN']).toContain(dead.body.code);
    });

    it('transfer closes and opens rows; history intact and stably ordered', async () => {
      const team = await makeTeam();
      const p = await addMember(team.id, team.captain, undefined, 'SUBSTITUTE');
      const outsider = await user();
      await post(`/teams/${team.id}/transfer-captain`, p, { newCaptainUserId: p.id }).expect(403);
      const notMember = await post(`/teams/${team.id}/transfer-captain`, team.captain, {
        newCaptainUserId: outsider.id,
      }).expect(404);
      expect(notMember.body.code).toBe('NOT_TEAM_MEMBER');
      await post(`/teams/${team.id}/transfer-captain`, team.captain, {
        newCaptainUserId: team.captain.id,
      }).expect(400);

      const res = await post(`/teams/${team.id}/transfer-captain`, team.captain, {
        newCaptainUserId: p.id,
      }).expect(200);
      const roles = Object.fromEntries(
        res.body.roster.map((r: { userId: string; role: string }) => [r.userId, r.role]),
      );
      expect(roles).toEqual({ [p.id]: 'CAPTAIN', [team.captain.id]: 'PLAYER' });
      expect(res.body.roster[0].userId).toBe(p.id);

      const rows = await db().teamMembership.findMany({
        where: { teamId: team.id },
        orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
      });
      expect(rows).toHaveLength(4);
      expect(rows.filter((r) => r.leftAt === null)).toHaveLength(2);
      expect(rows.filter((r) => r.leftReason === 'captain_transfer')).toHaveLength(2);
      const open = rows.filter((r) => r.leftAt === null);
      expect(open[0]!.joinedAt.getTime()).toBe(open[1]!.joinedAt.getTime());

      const h1 = await get(`/teams/${team.slug}/roster-history`).expect(200);
      const h2 = await get(`/teams/${team.slug}/roster-history`).expect(200);
      expect(h1.body.items).toEqual(h2.body.items);
      expect(h1.body.items).toHaveLength(4);
      expect(h1.body.items.slice(0, 2).every((e: { leftAt: null }) => e.leftAt === null)).toBe(
        true,
      );
      expect(h1.body.items.slice(2).map((e: { leftReason: string }) => e.leftReason)).toEqual([
        'captain_transfer',
        'captain_transfer',
      ]);
      const paged = await get(`/teams/${team.slug}/roster-history?page=2&pageSize=2`).expect(200);
      expect(paged.body.items).toEqual(h1.body.items.slice(2));

      expect(await auditCount('team.captain_transfer', team.id)).toBe(1);
      // The old captain is a plain member now: cannot transfer, can leave.
      await post(`/teams/${team.id}/transfer-captain`, team.captain, {
        newCaptainUserId: p.id,
      }).expect(403);
      expect((await get('/me', p).expect(200)).body.membership.role).toBe('CAPTAIN');
      await post(`/teams/${team.id}/leave`, team.captain).expect(204);
    });

    it('transfer to a suspended member → 409 MEMBER_INELIGIBLE (gate L-6)', async () => {
      const team = await makeTeam();
      const p = await addMember(team.id, team.captain);
      await db().user.update({ where: { id: p.id }, data: { status: 'SUSPENDED' } });
      const res = await post(`/teams/${team.id}/transfer-captain`, team.captain, {
        newCaptainUserId: p.id,
      }).expect(409);
      expect(res.body.code).toBe('MEMBER_INELIGIBLE');
      const captain = await db().teamMembership.findFirstOrThrow({
        where: { teamId: team.id, role: 'CAPTAIN', leftAt: null },
      });
      expect(captain.userId).toBe(team.captain.id);
    });

    it('leave vs remove race closes the membership exactly once', async () => {
      for (let round = 0; round < 3; round++) {
        const team = await makeTeam();
        const p = await addMember(team.id, team.captain);
        const [leave, remove] = await Promise.all([
          post(`/teams/${team.id}/leave`, p),
          post(`/teams/${team.id}/members/${p.id}/remove`, team.captain, { reason: 'race test' }),
        ]);
        expect([leave.status, remove.status].sort()).toEqual([204, 404]);
        expect((leave.status === 404 ? leave : remove).body.code).toBe('NOT_TEAM_MEMBER');
        const rows = await db().teamMembership.findMany({
          where: { teamId: team.id, userId: p.id },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.leftAt).not.toBeNull();
        expect(['left', 'removed']).toContain(rows[0]!.leftReason);
      }
    });

    it('transfer vs remove race leaves exactly one captain and a consistent roster', async () => {
      for (let round = 0; round < 3; round++) {
        const team = await makeTeam();
        const p = await addMember(team.id, team.captain);
        const [transfer, remove] = await Promise.all([
          post(`/teams/${team.id}/transfer-captain`, team.captain, { newCaptainUserId: p.id }),
          post(`/teams/${team.id}/members/${p.id}/remove`, admin, { reason: 'race test' }),
        ]);
        const captains = await db().teamMembership.findMany({
          where: { teamId: team.id, role: 'CAPTAIN', leftAt: null },
        });
        expect(captains).toHaveLength(1);
        if (transfer.status === 200) {
          expect(remove.status).toBe(409);
          expect(remove.body.code).toBe('CAPTAIN_MUST_TRANSFER');
          expect(captains[0]!.userId).toBe(p.id);
        } else {
          expect(transfer.status).toBe(404);
          expect(transfer.body.code).toBe('NOT_TEAM_MEMBER');
          expect(remove.status).toBe(204);
          expect(captains[0]!.userId).toBe(team.captain.id);
          expect(await db().teamMembership.count({ where: { userId: p.id, leftAt: null } })).toBe(
            0,
          );
        }
      }
    });
  });

  describe('idempotency', () => {
    const key = () => randomUUID();

    it('replay returns identical body + header; different body same key → 409; one effect', async () => {
      const u = await user();
      const k = key();
      const body = { name: `Idem ${uniq()}`, tag: 'IDEM' };
      const first = await post('/team-applications', u, body, { 'Idempotency-Key': k }).expect(201);
      expect(first.headers['idempotency-replayed']).toBeUndefined();
      const replay = await post(
        '/team-applications',
        u,
        { tag: 'IDEM', name: body.name },
        {
          'Idempotency-Key': k,
        },
      ).expect(201);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(await db().teamApplication.count({ where: { applicantUserId: u.id } })).toBe(1);
      expect(await auditCount('team_application.submit', first.body.id)).toBe(1);

      const reused = await post(
        '/team-applications',
        u,
        { ...body, tag: 'IDEM2' },
        {
          'Idempotency-Key': k,
        },
      ).expect(409);
      expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      const otherRoute = await post(`/team-applications/${first.body.id}/withdraw`, u, undefined, {
        'Idempotency-Key': k,
      }).expect(409);
      expect(otherRoute.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

      const stored = await db().idempotencyKey.findFirstOrThrow({
        where: { userId: u.id, key: k },
      });
      expect(stored).toMatchObject({ status: 'COMPLETED', responseStatus: 201, method: 'POST' });
      expect(stored.route).toBe('/api/v1/team-applications');
    });

    it('invalid key → 400; error responses are not stored (key released)', async () => {
      const u = await user();
      for (const bad of ['short', 'x'.repeat(65), 'has spaces in the key!!']) {
        const res = await post(
          '/team-applications',
          u,
          { name: 'Whatever Name', tag: 'WHAT' },
          {
            'Idempotency-Key': bad,
          },
        ).expect(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      }
      const k = key();
      const fail = await post(`/team-applications/${randomUUID()}/withdraw`, u, undefined, {
        'Idempotency-Key': k,
      }).expect(404);
      expect(fail.headers['idempotency-replayed']).toBeUndefined();
      expect(await db().idempotencyKey.count({ where: { userId: u.id, key: k } })).toBe(0);
      const invalid = await post(
        '/team-applications',
        u,
        { name: 'x', tag: 'Y' },
        {
          'Idempotency-Key': k,
        },
      ).expect(400);
      expect(invalid.body.code).toBe('VALIDATION_FAILED');
      expect(await db().idempotencyKey.count({ where: { userId: u.id, key: k } })).toBe(0);
      // The released key can be used for a real request afterwards.
      await post(
        '/team-applications',
        u,
        { name: `Released ${uniq()}`, tag: 'RLSD' },
        {
          'Idempotency-Key': k,
        },
      ).expect(201);
    });

    it('keys are scoped per user', async () => {
      const a = await user();
      const b = await user();
      const k = key();
      const ra = await post(
        '/team-applications',
        a,
        { name: `Scope A ${uniq()}`, tag: 'SCPA' },
        {
          'Idempotency-Key': k,
        },
      ).expect(201);
      const rb = await post(
        '/team-applications',
        b,
        { name: `Scope B ${uniq()}`, tag: 'SCPB' },
        {
          'Idempotency-Key': k,
        },
      ).expect(201);
      expect(rb.headers['idempotency-replayed']).toBeUndefined();
      expect(rb.body.id).not.toBe(ra.body.id);
    });

    it('concurrent requests with the same key ⇒ one effect', async () => {
      const team = await makeTeam();
      const invitee = await user();
      const k = key();
      const results: Response[] = await Promise.all(
        Array.from({ length: 5 }, () =>
          post(
            `/teams/${team.id}/invitations`,
            team.captain,
            {
              steamId64: invitee.steamId64,
              role: 'PLAYER',
            },
            { 'Idempotency-Key': k },
          ),
        ),
      );
      expect(await db().teamInvitation.count({ where: { teamId: team.id } })).toBe(1);
      const created = results.filter((r) => r.status === 201);
      expect(created.length).toBeGreaterThanOrEqual(1);
      const ids = new Set(created.map((r) => r.body.id as string));
      expect(ids.size).toBe(1);
      for (const r of results.filter((x) => x.status !== 201)) {
        expect(r.status).toBe(409);
        expect(['IDEMPOTENCY_IN_PROGRESS', 'INVITATION_ALREADY_PENDING']).toContain(r.body.code);
        if (r.body.code === 'IDEMPOTENCY_IN_PROGRESS') expect(r.headers['retry-after']).toBe('1');
      }
      expect(await auditCount('team_invitation.create', [...ids][0])).toBe(1);
    });

    it('reserve opportunistically purges long-expired keys (gate L-4)', async () => {
      const u = await user();
      const row = (k: string, hash: string, createdH: number, expiresH: number) => ({
        userId: u.id,
        key: k,
        method: 'POST',
        route: '/api/v1/team-applications',
        requestHash: hash.repeat(64),
        status: 'COMPLETED' as const,
        responseStatus: 201,
        responseBody: { id: k },
        createdAt: new Date(Date.now() - createdH * 3600_000),
        expiresAt: new Date(Date.now() - expiresH * 3600_000),
      });
      const old = await db().idempotencyKey.create({
        data: row(`purge-${randomUUID()}`, 'a', 50, 26),
      });
      // Expired, but still inside the one-hour grace period: kept.
      const recent = await db().idempotencyKey.create({
        data: row(`recent-${randomUUID()}`, 'b', 24.5, 0.5),
      });
      await post(
        '/team-applications',
        u,
        { name: `Purge ${uniq()}`, tag: newTag() },
        { 'Idempotency-Key': key() },
      ).expect(201);
      expect(await db().idempotencyKey.count({ where: { id: old.id } })).toBe(0);
      expect(await db().idempotencyKey.count({ where: { id: recent.id } })).toBe(1);
    });

    it('204 responses replay with a null body; expired keys are reusable', async () => {
      const team = await makeTeam();
      const p = await addMember(team.id, team.captain);
      const k = key();
      await post(`/teams/${team.id}/leave`, p, undefined, { 'Idempotency-Key': k }).expect(204);
      const replay = await post(`/teams/${team.id}/leave`, p, undefined, {
        'Idempotency-Key': k,
      }).expect(204);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(await auditCount('team_membership.leave')).toBeGreaterThanOrEqual(1);
      const row = await db().idempotencyKey.findFirstOrThrow({ where: { userId: p.id, key: k } });
      expect(row.responseBody).toBeNull();

      // Expire the stored key: the same key may now be used for a different request.
      await db().idempotencyKey.update({
        where: { id: row.id },
        data: {
          createdAt: new Date(Date.now() - 48 * 3600_000),
          expiresAt: new Date(Date.now() - 24 * 3600_000),
        },
      });
      const fresh = await post(
        '/team-applications',
        p,
        { name: `Expired ${uniq()}`, tag: 'EXPK' },
        {
          'Idempotency-Key': k,
        },
      ).expect(201);
      expect(fresh.headers['idempotency-replayed']).toBeUndefined();
      const reused = await db().idempotencyKey.findFirstOrThrow({
        where: { userId: p.id, key: k },
      });
      expect(reused.id).not.toBe(row.id);
      expect(reused.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    });
  });

  it('/me.membership is null without a team; roster entries carry userId publicly', async () => {
    const u = await user();
    expect((await get('/me', u).expect(200)).body.membership).toBeNull();
    const team = await makeTeam();
    const pub = await get(`/teams/${team.slug}`).expect(200);
    expect(pub.body.roster[0]).toMatchObject({ userId: team.captain.id });
    await get('/teams/no-such-team/roster-history').expect(404);
  });
});

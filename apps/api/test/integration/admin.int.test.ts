import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StubSteamProvider, testSteamId } from '../support/steam-stub.js';
import { createAuthTestApp, type LoggedIn, login, WEB } from './auth-helpers.js';
import { prismaOf, sampleSteamId, truncateAll } from './helpers.js';

/** Admin users/roles/audit API: RBAC, CSRF, uniqueness, self-lockout protection, audit. */
describe('admin API (real PostgreSQL + Redis)', () => {
  let app: NestExpressApplication;
  let op: StubSteamProvider;
  const adminSteamId = testSteamId();
  let admin: LoggedIn;
  let player: LoggedIn;
  let adminId: string;
  let playerId: string;

  beforeAll(async () => {
    ({ app, op } = await createAuthTestApp({ BOOTSTRAP_SUPER_ADMIN_STEAM_ID64: adminSteamId }));
    await truncateAll(app);
    admin = await login(app, op, adminSteamId);
    player = await login(app, op, testSteamId());
    const db = prismaOf(app);
    adminId = (await db.user.findUniqueOrThrow({ where: { steamId64: adminSteamId } })).id;
    playerId = (await db.user.findFirstOrThrow({ where: { id: { not: adminId } } })).id;
  });
  afterAll(async () => {
    if (app) {
      await truncateAll(app);
      await app.close();
    }
  });

  const server = () => app.getHttpServer();
  const post = (path: string, who: LoggedIn, body: object) =>
    request(server())
      .post(path)
      .set('Cookie', who.cookie)
      .set('Origin', WEB)
      .set('x-csrf-token', who.csrf)
      .send(body);

  it('anonymous → 401, non-admin → 403 on every admin endpoint', async () => {
    for (const path of ['/api/v1/admin/users', '/api/v1/admin/audit']) {
      const anon = await request(server()).get(path).expect(401);
      expect(anon.body.code).toBe('UNAUTHENTICATED');
      const denied = await request(server()).get(path).set('Cookie', player.cookie).expect(403);
      expect(denied.body.code).toBe('FORBIDDEN_ROLE');
    }
    await request(server()).post(`/api/v1/admin/users/${playerId}/roles`).send({}).expect(401);
    await post(`/api/v1/admin/users/${playerId}/roles`, player, {
      role: 'SUPER_ADMIN',
      scopeType: 'GLOBAL',
      reason: 'self promotion',
    }).expect(403);
  });

  it('a Steam display name that looks like an admin confers nothing', async () => {
    await prismaOf(app).steamProfile.create({
      data: { userId: playerId, steamDisplayName: 'SUPER_ADMIN' },
    });
    await prismaOf(app).playerProfile.update({
      where: { userId: playerId },
      data: { nickname: 'admin' },
    });
    await request(server()).get('/api/v1/admin/users').set('Cookie', player.cookie).expect(403);
  });

  it('SUPER_ADMIN lists and searches users', async () => {
    const res = await request(server())
      .get('/api/v1/admin/users')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.total).toBe(2);
    const me = res.body.items.find((u: { id: string }) => u.id === adminId);
    expect(me.roles).toEqual([
      expect.objectContaining({ role: 'SUPER_ADMIN', issuedById: null, reason: 'bootstrap:env' }),
    ]);
    const bySteam = await request(server())
      .get(`/api/v1/admin/users?q=${adminSteamId}`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(bySteam.body.items.map((u: { id: string }) => u.id)).toEqual([adminId]);
    const invalid = await request(server())
      .get('/api/v1/admin/users?pageSize=1000')
      .set('Cookie', admin.cookie)
      .expect(400);
    expect(invalid.body.code).toBe('VALIDATION_FAILED');
    const byNick = await request(server())
      .get('/api/v1/admin/users?q=PLAYER-')
      .set('Cookie', admin.cookie)
      .expect(200);
    // The player was renamed to "admin" above; only the admin keeps a generated nickname.
    expect(byNick.body.items.map((u: { id: string }) => u.id)).toEqual([adminId]);
    const wildcard = await request(server())
      .get('/api/v1/admin/users?q=%25')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(wildcard.body.total).toBe(0);
  });

  it('grant requires CSRF', async () => {
    await request(server())
      .post(`/api/v1/admin/users/${playerId}/roles`)
      .set('Cookie', admin.cookie)
      .set('Origin', WEB)
      .send({ role: 'MATCH_ADMIN', scopeType: 'GLOBAL', reason: 'help with matches' })
      .expect(403);
  });

  let grantId: string;
  it('grant → 201; duplicate active grant → 409; invalid inputs → 400/404/409', async () => {
    const ok = await post(`/api/v1/admin/users/${playerId}/roles`, admin, {
      role: 'MATCH_ADMIN',
      scopeType: 'GLOBAL',
      reason: 'help with matches',
    }).expect(201);
    expect(ok.body).toMatchObject({
      role: 'MATCH_ADMIN',
      scopeType: 'GLOBAL',
      scopeId: null,
      issuedById: adminId,
      reason: 'help with matches',
      revokedAt: null,
    });
    grantId = ok.body.id;

    const dup = await post(`/api/v1/admin/users/${playerId}/roles`, admin, {
      role: 'MATCH_ADMIN',
      scopeType: 'GLOBAL',
      reason: 'again',
    }).expect(409);
    expect(dup.body.message).toMatch(/already exists/);
    expect(dup.body.code).toBe('ROLE_ALREADY_GRANTED');

    await post(`/api/v1/admin/users/${playerId}/roles`, admin, {
      role: 'SUPER_ADMIN',
      scopeType: 'TEAM',
      scopeId: '00000000-0000-4000-8000-000000000000',
      reason: 'bad scope',
    }).expect(400);
    await post(`/api/v1/admin/users/${playerId}/roles`, admin, {
      role: 'TOURNAMENT_ADMIN',
      scopeType: 'TOURNAMENT',
      reason: 'missing scope id',
    }).expect(400);
    await post(`/api/v1/admin/users/${playerId}/roles`, admin, {
      role: 'TOURNAMENT_ADMIN',
      scopeType: 'TOURNAMENT',
      scopeId: '00000000-0000-4000-8000-000000000000',
      reason: 'unknown tournament',
    }).expect(404);
    await post(`/api/v1/admin/users/${playerId}/roles`, admin, {
      role: 'OBSERVER',
      scopeType: 'GLOBAL',
      reason: 'x',
    }).expect(400);
    await post(`/api/v1/admin/users/00000000-0000-4000-8000-000000000000/roles`, admin, {
      role: 'OBSERVER',
      scopeType: 'GLOBAL',
      reason: 'ghost user',
    }).expect(404);
    await post(`/api/v1/admin/users/not-a-uuid/roles`, admin, {
      role: 'OBSERVER',
      scopeType: 'GLOBAL',
      reason: 'bad id',
    }).expect(400);

    const sample = await prismaOf(app).user.create({
      data: { steamId64: sampleSteamId(), isSample: true },
    });
    await post(`/api/v1/admin/users/${sample.id}/roles`, admin, {
      role: 'OBSERVER',
      scopeType: 'GLOBAL',
      reason: 'sample user',
    }).expect(409);
  });

  it('concurrent duplicate grants: exactly one 201, the rest 409', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        post(`/api/v1/admin/users/${playerId}/roles`, admin, {
          role: 'OBSERVER',
          scopeType: 'GLOBAL',
          reason: 'race',
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
  });

  it('granted role takes effect from the DB; revoke works and is idempotent-safe (409)', async () => {
    const me = await request(server()).get('/api/v1/me').set('Cookie', player.cookie).expect(200);
    expect(me.body.roles.map((r: { role: string }) => r.role).sort()).toEqual([
      'MATCH_ADMIN',
      'OBSERVER',
    ]);

    const rev = await post(`/api/v1/admin/users/${playerId}/roles/${grantId}/revoke`, admin, {
      reason: 'no longer needed',
    }).expect(200);
    expect(rev.body.revokedAt).not.toBeNull();
    await post(`/api/v1/admin/users/${playerId}/roles/${grantId}/revoke`, admin, {
      reason: 'again please',
    }).expect(409);
    // Grant id must belong to the user in the path.
    await post(`/api/v1/admin/users/${adminId}/roles/${grantId}/revoke`, admin, {
      reason: 'wrong user',
    }).expect(404);
    // Admin list shows revoked grants too (newest first); /me shows active grants only.
    const list = await request(server())
      .get('/api/v1/admin/users')
      .set('Cookie', admin.cookie)
      .expect(200);
    const target = list.body.items.find((u: { id: string }) => u.id === playerId);
    const revoked = target.roles.find((r: { id: string }) => r.id === grantId);
    expect(revoked.revokedAt).not.toBeNull();
    const issued = target.roles.map((r: { issuedAt: string }) => Date.parse(r.issuedAt));
    expect([...issued].sort((x, y) => y - x)).toEqual(issued);
    const me2 = await request(server()).get('/api/v1/me').set('Cookie', player.cookie).expect(200);
    expect(me2.body.roles.map((r: { id: string }) => r.id)).not.toContain(grantId);
    // Re-grant after revoke is allowed (partial unique index only covers active grants).
    await post(`/api/v1/admin/users/${playerId}/roles`, admin, {
      role: 'MATCH_ADMIN',
      scopeType: 'GLOBAL',
      reason: 'back again',
    }).expect(201);
  });

  it('cannot revoke own SUPER_ADMIN grant (409)', async () => {
    const grant = await prismaOf(app).userRoleGrant.findFirstOrThrow({
      where: { userId: adminId, role: 'SUPER_ADMIN', revokedAt: null },
    });
    const res = await post(`/api/v1/admin/users/${adminId}/roles/${grant.id}/revoke`, admin, {
      reason: 'oops',
    }).expect(409);
    expect(res.body.message).toMatch(/own SUPER_ADMIN/);
    expect(res.body.code).toBe('LAST_SUPER_ADMIN');
  });

  it('two super admins revoking each other concurrently never leave zero super admins', async () => {
    const second = await post(`/api/v1/admin/users/${playerId}/roles`, admin, {
      role: 'SUPER_ADMIN',
      scopeType: 'GLOBAL',
      reason: 'second admin',
    }).expect(201);
    const adminGrant = await prismaOf(app).userRoleGrant.findFirstOrThrow({
      where: { userId: adminId, role: 'SUPER_ADMIN', revokedAt: null },
    });
    const [a, b] = await Promise.all([
      post(`/api/v1/admin/users/${playerId}/roles/${second.body.id}/revoke`, admin, {
        reason: 'race a',
      }),
      post(`/api/v1/admin/users/${adminId}/roles/${adminGrant.id}/revoke`, player, {
        reason: 'race b',
      }),
    ]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    expect(
      await prismaOf(app).userRoleGrant.count({ where: { role: 'SUPER_ADMIN', revokedAt: null } }),
    ).toBe(1);
  });

  it('audit list shows actions newest first, filterable; request ids are server-generated', async () => {
    // Whoever is still SUPER_ADMIN reads the audit log.
    const db = prismaOf(app);
    const stillAdmin =
      (
        await db.userRoleGrant.findFirstOrThrow({
          where: { role: 'SUPER_ADMIN', revokedAt: null },
        })
      ).userId === adminId
        ? admin
        : player;
    const res = await request(server())
      .get('/api/v1/admin/audit?pageSize=100')
      .set('Cookie', stillAdmin.cookie)
      .set('x-request-id', 'client-supplied-id')
      .expect(200);
    const actions: string[] = res.body.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'auth.login',
        'role_grant.bootstrap',
        'role_grant.create',
        'role_grant.revoke',
      ]),
    );
    const times = res.body.items.map((i: { createdAt: string }) => Date.parse(i.createdAt));
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    const revoke = res.body.items.find((i: { action: string }) => i.action === 'role_grant.revoke');
    expect(revoke.detail).toMatchObject({ reason: expect.any(String), role: expect.any(String) });

    const filtered = await request(server())
      .get('/api/v1/admin/audit?action=role_grant.create')
      .set('Cookie', stillAdmin.cookie)
      .expect(200);
    expect(
      filtered.body.items.every((i: { action: string }) => i.action === 'role_grant.create'),
    ).toBe(true);
    await request(server())
      .get('/api/v1/admin/audit?action=DROP%20TABLE')
      .set('Cookie', stillAdmin.cookie)
      .expect(400);

    // Client-supplied x-request-id lands only in detail.clientRequestId.
    await request(server())
      .post(`/api/v1/admin/users/${playerId}/roles`)
      .set('Cookie', stillAdmin.cookie)
      .set('Origin', WEB)
      .set('x-csrf-token', stillAdmin.csrf)
      .set('x-request-id', 'forged-correlation-id')
      .send({ role: 'TOURNAMENT_ADMIN', scopeType: 'GLOBAL', reason: 'request id test' })
      .expect(201);
    const row = await db.auditLog.findFirstOrThrow({
      where: {
        action: 'role_grant.create',
        detailJson: { path: ['reason'], equals: 'request id test' },
      },
    });
    expect(row.requestId).not.toBe('forged-correlation-id');
    expect(row.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.detailJson).toMatchObject({ clientRequestId: 'forged-correlation-id' });
  });
});

describe('admin API: grant re-checks the actor under lock (security gate L-2)', () => {
  let app: NestExpressApplication;
  let op: StubSteamProvider;
  const adminSteamId = testSteamId();

  beforeAll(async () => {
    ({ app, op } = await createAuthTestApp({ BOOTSTRAP_SUPER_ADMIN_STEAM_ID64: adminSteamId }));
    await truncateAll(app);
  });
  afterAll(async () => {
    if (app) {
      await truncateAll(app);
      await app.close();
    }
  });

  it('a grant racing with the revocation of its issuer fails with 403', async () => {
    const admin = await login(app, op, adminSteamId);
    await login(app, op, testSteamId());
    const db = prismaOf(app);
    const adminId = (await db.user.findUniqueOrThrow({ where: { steamId64: adminSteamId } })).id;
    const targetId = (await db.user.findFirstOrThrow({ where: { id: { not: adminId } } })).id;

    let pending: Promise<request.Response> | undefined;
    // Uncommitted revocation: RolesGuard (plain read) still sees the grant as active, so only
    // the in-transaction FOR SHARE re-check can stop the grant once the revoke commits.
    await db.$transaction(
      async (tx) => {
        await tx.userRoleGrant.updateMany({
          where: { userId: adminId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        pending = request(app.getHttpServer())
          .post(`/api/v1/admin/users/${targetId}/roles`)
          .set('Cookie', admin.cookie)
          .set('Origin', WEB)
          .set('x-csrf-token', admin.csrf)
          .send({ role: 'SUPER_ADMIN', scopeType: 'GLOBAL', reason: 'sock puppet' })
          .then((r) => r);
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
      { timeout: 10_000 },
    );
    const res = await pending!;
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');
    expect(await db.userRoleGrant.count({ where: { userId: targetId } })).toBe(0);
  });
});

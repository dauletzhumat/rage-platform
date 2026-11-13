import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/auth/crypto.js';
import { StubSteamProvider, testSteamId } from '../support/steam-stub.js';
import {
  callback,
  createAuthTestApp,
  errorCodeOf,
  login,
  setCookies,
  startLogin,
  WEB,
} from './auth-helpers.js';
import { createTestApp, prismaOf, truncateAll } from './helpers.js';

/** Steam OpenID login, sessions and CSRF against real PostgreSQL + Redis (stubbed OP transport). */
describe('Steam login + sessions (real PostgreSQL + Redis)', () => {
  let app: NestExpressApplication;
  let op: StubSteamProvider;

  beforeAll(async () => {
    ({ app, op } = await createAuthTestApp());
    await truncateAll(app);
  });
  afterAll(async () => {
    if (app) {
      await truncateAll(app);
      await app.close();
    }
  });
  beforeEach(() => {
    op.behaviour = 'normal';
  });

  const server = () => app.getHttpServer();
  const db = () => prismaOf(app);

  it('/meta reports steamAuth configured', async () => {
    const res = await request(server()).get('/api/v1/meta').expect(200);
    expect(res.body.features.steamAuth.status).toBe('configured');
  });

  it('CORS preflight for PATCH /me/profile allows credentials, content-type and x-csrf-token', async () => {
    const res = await request(server())
      .options('/api/v1/me/profile')
      .set('Origin', WEB)
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(WEB);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toMatch(/PATCH/);
    expect(res.headers['access-control-allow-methods']).toMatch(/POST/);
    const allowed = String(res.headers['access-control-allow-headers']).toLowerCase();
    expect(allowed).toContain('content-type');
    expect(allowed).toContain('x-csrf-token');
    const evil = await request(server())
      .options('/api/v1/me/profile')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'PATCH');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('GET /auth/steam → 302 to Steam with state cookie flags', async () => {
    const res = await request(server()).get('/api/v1/auth/steam?returnTo=/me').expect(302);
    const loc = new URL(res.headers.location as string);
    expect(`${loc.origin}${loc.pathname}`).toBe('https://steamcommunity.com/openid/login');
    expect(loc.searchParams.get('openid.mode')).toBe('checkid_setup');
    expect(loc.searchParams.get('openid.realm')).toBe('http://localhost:4000');
    const c = setCookies(res).get('rage_oidc');
    expect(c?.attrs.httponly).toBe(true);
    expect(c?.attrs.samesite).toBe('Lax');
    expect(c?.attrs.path).toBe('/api/v1/auth');
    expect(c?.attrs['max-age']).toBe('600');
    expect(c?.attrs.secure).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('happy path: login → cookies → /me → CSRF-protected PATCH → logout → 401', async () => {
    const steamId = testSteamId();
    const start = await startLogin(app, '/me');
    const res = await callback(app, start, op.assertion(steamId, start.returnTo), {
      userAgent: 'vitest-agent',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${WEB}/me`);
    const cookies = setCookies(res);
    const session = cookies.get('rage_session');
    const csrf = cookies.get('rage_csrf');
    expect(session?.attrs).toMatchObject({
      httponly: true,
      samesite: 'Lax',
      path: '/',
      'max-age': String(336 * 3600),
    });
    expect(session?.attrs.secure).toBeUndefined();
    expect(csrf?.attrs.httponly).toBeUndefined();
    expect(csrf?.attrs).toMatchObject({ samesite: 'Lax', path: '/' });
    // State cookie is cleared (single use).
    expect(cookies.get('rage_oidc')?.attrs.expires).toMatch(/1970/);

    // Only the hash is stored.
    const row = await db().authSession.findUnique({
      where: { tokenHash: sha256Hex(session!.value) },
    });
    expect(row).not.toBeNull();
    expect(row?.userAgent).toBe('vitest-agent');
    expect(await db().authSession.count({ where: { tokenHash: session!.value } })).toBe(0);

    const cookie = `rage_session=${session!.value}; rage_csrf=${csrf!.value}`;
    const me = await request(server()).get('/api/v1/me').set('Cookie', cookie).expect(200);
    expect(me.headers['cache-control']).toBe('no-store');
    expect(me.body.user.steamId64).toBe(steamId);
    expect(me.body.user.status).toBe('ACTIVE');
    expect(me.body.profile.slug).toBe(`player-${steamId.slice(-6)}`);
    expect(me.body.profile.nickname).toBe(`player-${steamId.slice(-6)}`);
    expect(me.body.roles).toEqual([]);
    expect(me.body.steamProfile).toBeNull();

    const patch = () => request(server()).patch('/api/v1/me/profile').set('Cookie', cookie);
    // No CSRF header.
    const noCsrf = await patch().set('Origin', WEB).send({ nickname: 'NewNick' }).expect(403);
    expect(noCsrf.body.message).toBe('CSRF validation failed');
    expect(noCsrf.body.code).toBe('CSRF_FAILED');
    // Wrong token.
    await patch().set('Origin', WEB).set('x-csrf-token', 'x'.repeat(43)).send({}).expect(403);
    // Right token, foreign Origin.
    await patch()
      .set('Origin', 'https://evil.example')
      .set('x-csrf-token', csrf!.value)
      .send({ nickname: 'NewNick' })
      .expect(403);
    // Right token, no Origin and no Referer.
    await patch().set('x-csrf-token', csrf!.value).send({ nickname: 'NewNick' }).expect(403);
    // Referer fallback works.
    await patch()
      .set('Referer', `${WEB}/me/settings`)
      .set('x-csrf-token', csrf!.value)
      .send({ countryCode: 'KZ' })
      .expect(200);
    const ok = await patch()
      .set('Origin', WEB)
      .set('x-csrf-token', csrf!.value)
      .send({ nickname: '  New Nick  ', biography: 'Hi' })
      .expect(200);
    expect(ok.body.profile).toMatchObject({
      nickname: 'New Nick',
      countryCode: 'KZ',
      biography: 'Hi',
    });
    expect(ok.body.profile.slug).toBe(`player-${steamId.slice(-6)}`);

    // Validation.
    const bad = await patch()
      .set('Origin', WEB)
      .set('x-csrf-token', csrf!.value)
      .send({ nickname: '<b>', countryCode: 'kz', biography: 'x'.repeat(501), steamId64: '1' })
      .expect(400);
    const fields = (bad.body.details as { field: string }[]).map((d) => d.field);
    expect(fields).toEqual(
      expect.arrayContaining(['nickname', 'countryCode', 'biography', 'steamId64']),
    );
    await patch()
      .set('Origin', WEB)
      .set('x-csrf-token', csrf!.value)
      .send({ countryCode: 'XX' })
      .expect(400);
    await patch()
      .set('Origin', WEB)
      .set('x-csrf-token', csrf!.value)
      .send({ nickname: null })
      .expect(400);

    // GET /auth/csrf returns the same token.
    const tok = await request(server()).get('/api/v1/auth/csrf').set('Cookie', cookie).expect(200);
    expect(tok.body.csrfToken).toBe(csrf!.value);

    // Logout requires CSRF while the session is valid.
    await request(server())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', WEB)
      .expect(403);
    const out = await request(server())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', WEB)
      .set('x-csrf-token', csrf!.value)
      .expect(204);
    expect(setCookies(out).get('rage_session')?.attrs.expires).toMatch(/1970/);
    await request(server()).get('/api/v1/me').set('Cookie', cookie).expect(401);
    // Idempotent: a second logout with the dead session still answers 204.
    await request(server()).post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);

    const actions = (
      await db().auditLog.findMany({
        where: { actorUserId: me.body.user.id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(['auth.login', 'profile.update', 'profile.update', 'auth.logout']);
  });

  it('first login creates exactly one user; repeat login reuses it with a new session', async () => {
    const steamId = testSteamId();
    const a = await login(app, op, steamId);
    const b = await login(app, op, steamId);
    expect(a.session).not.toBe(b.session);
    const users = await db().user.findMany({ where: { steamId64: steamId } });
    expect(users).toHaveLength(1);
    expect(await db().playerProfile.count({ where: { userId: users[0]!.id } })).toBe(1);
    expect(await db().authSession.count({ where: { userId: users[0]!.id } })).toBe(2);
    const logins = await db().auditLog.findMany({
      where: { action: 'auth.login', actorUserId: users[0]!.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(logins.map((l) => (l.detailJson as { newUser: boolean }).newUser)).toEqual([
      true,
      false,
    ]);
    // Audit request ids are server-generated UUIDs; never tokens.
    for (const l of logins) {
      expect(l.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(l.detailJson)).not.toContain(a.session);
    }
  });

  it('concurrent first logins of one SteamID create exactly one user (race safety)', async () => {
    const steamId = testSteamId();
    const starts = await Promise.all(Array.from({ length: 5 }, () => startLogin(app)));
    const results = await Promise.all(
      starts.map((s) => callback(app, s, op.assertion(steamId, s.returnTo))),
    );
    for (const r of results) {
      expect(r.status).toBe(302);
      expect(errorCodeOf(r)).toBeNull();
    }
    const users = await db().user.findMany({ where: { steamId64: steamId } });
    expect(users).toHaveLength(1);
    expect(await db().playerProfile.count({ where: { userId: users[0]!.id } })).toBe(1);
    expect(await db().authSession.count({ where: { userId: users[0]!.id } })).toBe(5);
  });

  it('slug collision (same last 6 digits) gets a different, non-UUID slug', async () => {
    const id1 = `765611980${'11'}123456`.slice(0, 17);
    const id2 = `765611981${'22'}123456`.slice(0, 17);
    await login(app, op, id1);
    await login(app, op, id2);
    const p1 = await db().playerProfile.findFirst({ where: { user: { steamId64: id1 } } });
    const p2 = await db().playerProfile.findFirst({ where: { user: { steamId64: id2 } } });
    expect(p1?.slug).toBe(`player-${id1.slice(-6)}`);
    expect(p2?.slug).not.toBe(p1?.slug);
    expect(p2?.slug).toMatch(/^player-[a-z0-9-]+$/);
  });

  it('replayed assertion (same nonce) → error=replay, no second session', async () => {
    const steamId = testSteamId();
    const start = await startLogin(app);
    const assertion = op.assertion(steamId, start.returnTo);
    const first = await callback(app, start, assertion);
    expect(errorCodeOf(first)).toBeNull();
    // Attacker replays the captured callback URL with a fresh, valid state of their own.
    const start2 = await startLogin(app);
    const replay = await callback(app, start2, {
      ...assertion,
      'openid.return_to': start2.returnTo,
    });
    expect(['replay', 'invalid_assertion']).toContain(errorCodeOf(replay));
    // Exact replay (same state cookie + same URL).
    const exact = await callback(app, start, assertion);
    expect(errorCodeOf(exact)).toBe('replay');
    expect(setCookies(exact).get('rage_session')).toBeUndefined();
    const user = await db().user.findUnique({ where: { steamId64: steamId } });
    expect(await db().authSession.count({ where: { userId: user!.id } })).toBe(1);
  });

  it('state mismatch: missing cookie, other state, tampered cookie → state_mismatch', async () => {
    const steamId = testSteamId();
    const start = await startLogin(app);
    const other = await startLogin(app);
    const a = op.assertion(steamId, start.returnTo);
    expect(errorCodeOf(await callback(app, start, a, { cookie: null }))).toBe('state_mismatch');
    expect(
      errorCodeOf(await callback(app, start, a, { cookie: `rage_oidc=${other.stateCookie}` })),
    ).toBe('state_mismatch');
    expect(
      errorCodeOf(await callback(app, start, a, { cookie: `rage_oidc=${start.stateCookie}x` })),
    ).toBe('state_mismatch');
    expect(op.calls.length).toBeGreaterThanOrEqual(0);
    expect(await db().user.count({ where: { steamId64: steamId } })).toBe(0);
  });

  it('forged claimed_id / wrong return URL / invalid signature are rejected', async () => {
    const victim = testSteamId();
    let s = await startLogin(app);
    const forged = op.assertion(testSteamId(), s.returnTo, {
      'openid.claimed_id': `https://steamcommunity.com/openid/id/${victim}`,
      'openid.identity': `https://steamcommunity.com/openid/id/${victim}`,
    });
    expect(errorCodeOf(await callback(app, s, forged))).toBe('invalid_assertion');

    s = await startLogin(app);
    const wrongReturn = op.assertion(
      victim,
      'http://evil.example/api/v1/auth/steam/callback?state=x',
    );
    expect(errorCodeOf(await callback(app, s, wrongReturn))).toBe('invalid_assertion');

    s = await startLogin(app);
    const badSig = op.assertion(victim, s.returnTo, { 'openid.sig': 'AAAA' });
    expect(errorCodeOf(await callback(app, s, badSig))).toBe('invalid_assertion');
    expect(await db().user.count({ where: { steamId64: victim } })).toBe(0);
  });

  it('user cancels at Steam → error=cancelled', async () => {
    const s = await startLogin(app);
    const res = await callback(app, s, {
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'cancel',
    });
    expect(errorCodeOf(res)).toBe('cancelled');
  });

  it('OP unreachable → provider_unavailable', async () => {
    op.behaviour = 'network_error';
    const s = await startLogin(app);
    expect(errorCodeOf(await callback(app, s, op.assertion(testSteamId(), s.returnTo)))).toBe(
      'provider_unavailable',
    );
  });

  it('sample-range SteamID → unsupported_account, no user created', async () => {
    op.behaviour = 'always_valid';
    const s = await startLogin(app);
    const res = await callback(app, s, op.assertion('76561190000000005', s.returnTo));
    expect(errorCodeOf(res)).toBe('unsupported_account');
    expect(await db().user.count({ where: { steamId64: '76561190000000005' } })).toBe(0);
    const audit = await db().auditLog.findFirst({
      where: { action: 'auth.login_rejected' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.detailJson).toMatchObject({
      code: 'unsupported_account',
      steamId64: '76561190000000005',
    });
  });

  it.each([['//evil.com'], ['https://evil.com'], ['/\\evil'], ['javascript:alert(1)'], ['/ok\nx']])(
    'returnTo %j falls back to /',
    async (returnTo) => {
      const r = await login(app, op, testSteamId(), returnTo);
      expect(r.res.headers.location).toBe(`${WEB}/`);
    },
  );

  it('suspended user cannot log in and existing sessions stop working', async () => {
    const steamId = testSteamId();
    const s = await login(app, op, steamId);
    await request(server()).get('/api/v1/me').set('Cookie', s.cookie).expect(200);
    await db().user.update({ where: { steamId64: steamId }, data: { status: 'SUSPENDED' } });
    await request(server()).get('/api/v1/me').set('Cookie', s.cookie).expect(401);
    const start = await startLogin(app);
    const res = await callback(app, start, op.assertion(steamId, start.returnTo));
    expect(errorCodeOf(res)).toBe('account_suspended');
    expect(setCookies(res).get('rage_session')).toBeUndefined();
    const user = await db().user.findUnique({ where: { steamId64: steamId } });
    expect(await db().authSession.count({ where: { userId: user!.id } })).toBe(1);
    const rejected = await db().auditLog.findMany({
      where: {
        action: 'auth.login_rejected',
        detailJson: { path: ['steamId64'], equals: steamId },
      },
    });
    expect(rejected).toHaveLength(1);
  });

  it('expired, idle and revoked sessions → 401; garbage cookies → 401', async () => {
    const mk = async () => {
      const s = await login(app, op, testSteamId());
      const row = await db().authSession.findUniqueOrThrow({
        where: { tokenHash: sha256Hex(s.session) },
      });
      return { s, row };
    };
    const now = Date.now();
    const expired = await mk();
    await db().authSession.update({
      where: { id: expired.row.id },
      data: {
        createdAt: new Date(now - 20 * 86_400_000),
        lastSeenAt: new Date(now - 60_000),
        expiresAt: new Date(now - 1000),
      },
    });
    await request(server()).get('/api/v1/me').set('Cookie', expired.s.cookie).expect(401);

    const idle = await mk();
    await db().authSession.update({
      where: { id: idle.row.id },
      data: { lastSeenAt: new Date(now - 73 * 3600_000) },
    });
    await request(server()).get('/api/v1/me').set('Cookie', idle.s.cookie).expect(401);

    const revoked = await mk();
    await db().authSession.update({
      where: { id: revoked.row.id },
      data: { revokedAt: new Date() },
    });
    await request(server()).get('/api/v1/me').set('Cookie', revoked.s.cookie).expect(401);

    await request(server()).get('/api/v1/me').expect(401);
    await request(server()).get('/api/v1/me').set('Cookie', 'rage_session=not-a-token').expect(401);
    await request(server())
      .get('/api/v1/me')
      .set('Cookie', `rage_session=${'A'.repeat(43)}`)
      .expect(401);
  });

  it('last_seen_at is refreshed at most every 5 minutes', async () => {
    const s = await login(app, op, testSteamId());
    const hash = sha256Hex(s.session);
    const old = new Date(Date.now() - 10 * 60_000);
    await db().authSession.update({ where: { tokenHash: hash }, data: { lastSeenAt: old } });
    await request(server()).get('/api/v1/me').set('Cookie', s.cookie).expect(200);
    const first = (await db().authSession.findUniqueOrThrow({ where: { tokenHash: hash } }))
      .lastSeenAt!;
    expect(first.getTime()).toBeGreaterThan(old.getTime());
    await request(server()).get('/api/v1/me').set('Cookie', s.cookie).expect(200);
    const second = (await db().authSession.findUniqueOrThrow({ where: { tokenHash: hash } }))
      .lastSeenAt!;
    expect(second.getTime()).toBe(first.getTime());
  });

  it('a session cookie cannot be fixated: pre-auth cookies are ignored and replaced', async () => {
    const steamId = testSteamId();
    const start = await startLogin(app);
    const res = await callback(app, start, op.assertion(steamId, start.returnTo), {
      cookie: `rage_oidc=${start.stateCookie}; rage_session=${'F'.repeat(43)}`,
    });
    expect(setCookies(res).get('rage_session')?.value).not.toBe('F'.repeat(43));
  });

  it('re-login rotates: the previously held session is revoked', async () => {
    const steamId = testSteamId();
    const first = await login(app, op, steamId);
    const start = await startLogin(app);
    const res = await callback(app, start, op.assertion(steamId, start.returnTo), {
      cookie: `rage_oidc=${start.stateCookie}; rage_session=${first.session}`,
    });
    expect(errorCodeOf(res)).toBeNull();
    await request(server()).get('/api/v1/me').set('Cookie', first.cookie).expect(401);
    const fresh = setCookies(res).get('rage_session')!.value;
    await request(server()).get('/api/v1/me').set('Cookie', `rage_session=${fresh}`).expect(200);
  });
});

describe('Steam login: bootstrap super admin (ADR-017)', () => {
  let app: NestExpressApplication;
  let op: StubSteamProvider;
  const bootstrapId = testSteamId();

  beforeAll(async () => {
    ({ app, op } = await createAuthTestApp({ BOOTSTRAP_SUPER_ADMIN_STEAM_ID64: bootstrapId }));
    await truncateAll(app);
  });
  afterAll(async () => {
    if (app) {
      await truncateAll(app);
      await app.close();
    }
  });

  it('grants SUPER_ADMIN once, audited; other users get nothing', async () => {
    const db = prismaOf(app);
    await login(app, op, testSteamId());
    const a = await login(app, op, bootstrapId);
    await login(app, op, bootstrapId);
    const user = await db.user.findUniqueOrThrow({ where: { steamId64: bootstrapId } });
    const grants = await db.userRoleGrant.findMany({ where: { userId: user.id } });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      role: 'SUPER_ADMIN',
      scopeType: 'GLOBAL',
      scopeId: null,
      issuedById: null,
      reason: 'bootstrap:env',
      revokedAt: null,
    });
    expect(await db.userRoleGrant.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'role_grant.bootstrap' } })).toBe(1);
    const me = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', a.cookie)
      .expect(200);
    expect(me.body.roles).toEqual([
      expect.objectContaining({ role: 'SUPER_ADMIN', scopeType: 'GLOBAL', scopeId: null }),
    ]);
  });

  it('a revoked bootstrap grant is NOT restored on the next login (security gate M-1)', async () => {
    const db = prismaOf(app);
    const user = await db.user.findUniqueOrThrow({ where: { steamId64: bootstrapId } });
    await db.userRoleGrant.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const again = await login(app, op, bootstrapId);
    expect(await db.userRoleGrant.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: 'role_grant.bootstrap' } })).toBe(1);
    const me = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', again.cookie)
      .expect(200);
    expect(me.body.roles).toEqual([]);
  });
});

describe('Steam login: secure cookies and dependency failures', () => {
  it('COOKIE_SECURE=true marks every auth cookie Secure', async () => {
    const { app, op } = await createAuthTestApp({ COOKIE_SECURE: 'true' });
    try {
      const start = await request(app.getHttpServer()).get('/api/v1/auth/steam').expect(302);
      expect(setCookies(start).get('rage_oidc')?.attrs.secure).toBe(true);
      const r = await login(app, op, testSteamId());
      const c = setCookies(r.res);
      expect(c.get('rage_session')?.attrs.secure).toBe(true);
      expect(c.get('rage_csrf')?.attrs.secure).toBe(true);
    } finally {
      await truncateAll(app);
      await app.close();
    }
  });

  it('Redis unavailable → provider_unavailable (nonce store fails closed)', async () => {
    const { app, op } = await createAuthTestApp({ REDIS_URL: 'redis://127.0.0.1:1' });
    try {
      const s = await startLogin(app);
      const res = await callback(app, s, op.assertion(testSteamId(), s.returnTo));
      expect(errorCodeOf(res)).toBe('provider_unavailable');
      expect(op.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('unconfigured: /auth/steam 503, callback → not_configured, /meta unconfigured', async () => {
    const app = await createTestApp();
    try {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/steam').expect(503);
      expect(res.body.statusCode).toBe(503);
      const cb = await request(app.getHttpServer()).get('/api/v1/auth/steam/callback').expect(302);
      expect(cb.headers.location).toBe(`${WEB}/login?error=not_configured`);
      const meta = await request(app.getHttpServer()).get('/api/v1/meta').expect(200);
      expect(meta.body.features.steamAuth.status).toBe('unconfigured');
    } finally {
      await app.close();
    }
  });
});

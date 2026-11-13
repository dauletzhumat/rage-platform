import type { NestExpressApplication } from '@nestjs/platform-express';
import { Writable } from 'node:stream';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testSteamId } from '../support/steam-stub.js';
import { createAuthTestApp, login, startLogin } from './auth-helpers.js';
import { truncateAll } from './helpers.js';

describe('auth logging hygiene', () => {
  let app: NestExpressApplication;
  const lines: string[] = [];
  let loginTokens: string[] = [];

  beforeAll(async () => {
    const logStream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    let op;
    ({ app, op } = await createAuthTestApp({ LOG_LEVEL: 'info' }, { logStream }));
    await truncateAll(app);
    // A successful login, so tokens exist that must not be logged.
    const s = await login(app, op, testSteamId());
    loginTokens = [s.session, s.csrf];
  });
  afterAll(async () => {
    if (app) {
      await truncateAll(app);
      await app.close();
    }
  });

  it('never logs OpenID query params, nonces, state, cookies or session tokens', async () => {
    const start = await startLogin(app);
    await request(app.getHttpServer())
      .get(
        `/api/v1/auth/steam/callback?state=${start.state}&openid.sig=SECRETSIGMARK&openid.response_nonce=NONCEMARK&openid.claimed_id=CLAIMEDMARK`,
      )
      .set('Cookie', `rage_oidc=${start.stateCookie}; rage_session=COOKIEMARK`)
      .set('x-rage-ssr-token', 'SSRTOKENMARK')
      .expect(302);
    await new Promise((r) => setTimeout(r, 50));
    const joined = lines.join('\n');
    expect(joined).toContain('/api/v1/auth/steam/callback');
    expect(joined).not.toMatch(/SECRETSIGMARK|NONCEMARK|CLAIMEDMARK|COOKIEMARK|SSRTOKENMARK/);
    expect(joined).not.toContain(start.state);
    expect(joined).not.toContain(start.stateCookie);
    for (const t of loginTokens) {
      expect(joined).not.toContain(t);
    }
    expect(joined).not.toContain('openid.');
  });
});

describe('auth rate limits and SSR client-IP keying (AUTH.md §8)', () => {
  let app: NestExpressApplication;
  const SSR = 'ssr-token-for-tests-'.padEnd(48, 'z');

  beforeAll(async () => {
    ({ app } = await createAuthTestApp({
      AUTH_RATE_LIMIT_PER_MINUTE: '2',
      RATE_LIMIT_PER_MINUTE: '3',
      INTERNAL_SSR_TOKEN: SSR,
    }));
  });
  afterAll(async () => {
    await app?.close();
  });

  it('strict bucket on /auth/*: third login start in a minute → 429 with Retry-After', async () => {
    const s = app.getHttpServer();
    await request(s).get('/api/v1/auth/steam').expect(302);
    await request(s).get('/api/v1/auth/steam').expect(302);
    const limited = await request(s).get('/api/v1/auth/steam').expect(429);
    expect(limited.headers['retry-after-auth']).toBeDefined();
    // Standard header mirrored for clients (QA gate M1 P3-1).
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body.code).toBe('RATE_LIMITED');
    // Public reads are unaffected by the auth bucket.
    await request(s).get('/api/v1/meta').expect(200);
  });

  it('spoofed x-rage-client-ip without a valid SSR token is ignored', async () => {
    const s = app.getHttpServer();
    // Fresh route bucket (/teams): default limit 3/min.
    for (let i = 0; i < 3; i++) {
      await request(s)
        .get('/api/v1/teams')
        .set('x-rage-client-ip', `203.0.113.${i + 1}`)
        .set('x-rage-ssr-token', 'wrong-token')
        .expect(200);
    }
    await request(s).get('/api/v1/teams').set('x-rage-client-ip', '203.0.113.99').expect(429);
  });

  it('with a valid SSR token each visitor IP gets its own bucket', async () => {
    const s = app.getHttpServer();
    const visit = (ip: string) =>
      request(s).get('/api/v1/players').set('x-rage-ssr-token', SSR).set('x-rage-client-ip', ip);
    for (let i = 0; i < 3; i++) await visit('198.51.100.1').expect(200);
    await visit('198.51.100.1').expect(429);
    await visit('198.51.100.2').expect(200);
    // Direct (non-SSR) traffic from the server's own IP is a separate bucket.
    await request(s).get('/api/v1/players').expect(200);
  });
});

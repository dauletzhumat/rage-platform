import type { NestExpressApplication } from '@nestjs/platform-express';
import { Writable } from 'node:stream';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HealthController } from '../../src/health/health.controller.js';
import { PrismaService } from '../../src/infra/prisma/prisma.service.js';
import { createTestApp, prismaOf, sampleSteamId, truncateAll } from './helpers.js';

/** Regression tests for the M0 security review findings. */
describe('security regressions', () => {
  let app: NestExpressApplication;
  const logLines: string[] = [];

  beforeAll(async () => {
    const logStream = new Writable({
      write(chunk, _enc, cb) {
        logLines.push(String(chunk));
        cb();
      },
    });
    app = await createTestApp({ LOG_LEVEL: 'info' }, { logStream });
    await truncateAll(app);
    const db = prismaOf(app);

    const team = await db.team.create({
      data: { slug: 'percent-team', name: 'Percent Team', tag: 'PCT', isSample: true },
    });
    for (const [slug, status] of [
      ['visible-member', 'ACTIVE'],
      ['suspended-member', 'SUSPENDED'],
    ] as const) {
      const user = await db.user.create({
        data: {
          steamId64: sampleSteamId(),
          status,
          isSample: true,
          playerProfile: { create: { nickname: slug, slug } },
        },
      });
      await db.teamMembership.create({
        data: {
          teamId: team.id,
          userId: user.id,
          role: slug === 'visible-member' ? 'CAPTAIN' : 'PLAYER',
        },
      });
    }
  });

  afterAll(async () => {
    if (app) {
      await truncateAll(app);
      await app.close();
    }
  });

  it('MEDIUM-1: request logs never contain query strings or sensitive headers', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/teams?q=SECRETMARK')
      .set('Cookie', 'rage_session=COOKIEMARK')
      .set('Authorization', 'Bearer AUTHMARK')
      .expect(200);
    await new Promise((r) => setTimeout(r, 50));
    const joined = logLines.join('\n');
    expect(joined).toContain('/api/v1/teams'); // the request was logged…
    expect(joined).not.toMatch(/SECRETMARK|COOKIEMARK|AUTHMARK/); // …without secrets
  });

  it('LOW-1: LIKE wildcards in search are matched literally', async () => {
    const pct = await request(app.getHttpServer()).get('/api/v1/teams?q=%25').expect(200);
    expect(pct.body.total).toBe(0);
    const underscore = await request(app.getHttpServer()).get('/api/v1/teams?q=_').expect(200);
    expect(underscore.body.total).toBe(0);
    const normal = await request(app.getHttpServer()).get('/api/v1/teams?q=percent').expect(200);
    expect(normal.body.total).toBe(1);
  });

  it('LOW-2: suspended users are hidden from public rosters and member counts', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/teams/percent-team').expect(200);
    expect(res.body.roster.map((r: { playerSlug: string }) => r.playerSlug)).toEqual([
      'visible-member',
    ]);
    expect(res.body.activeMemberCount).toBe(1);
  });

  it('LOW-3: concurrent readiness probes share one dependency check per cache window', async () => {
    const prisma = app.get(PrismaService);
    const spy = vi.spyOn(prisma, 'ping');
    await new Promise((r) => setTimeout(r, HealthController.READINESS_CACHE_MS + 50));
    spy.mockClear();
    const results = await Promise.all(
      Array.from({ length: 25 }, () => request(app.getHttpServer()).get('/api/v1/health/ready')),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('INFO: 429 envelope has a clean message', async () => {
    const limited = await createTestApp({ RATE_LIMIT_PER_MINUTE: '1' });
    try {
      await request(limited.getHttpServer()).get('/api/v1/meta').expect(200);
      const res = await request(limited.getHttpServer()).get('/api/v1/meta').expect(429);
      expect(res.body.message).toBe('Too many requests, please retry later');
    } finally {
      await limited.close();
    }
  });
});

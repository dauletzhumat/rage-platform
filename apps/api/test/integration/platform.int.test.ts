import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

/** Cross-cutting HTTP behaviour: health, meta, errors, headers, CORS, rate limits, docs. */
describe('platform (real PostgreSQL + Redis)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ API_DOCS_ENABLED: 'true' });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/health/live → 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/v1/health/ready → 200 with both dependencies up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: { status: 'up' }, redis: { status: 'up' } },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('GET /api/v1/meta: Steam auth unconfigured without env; CS2 not implemented', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/meta').expect(200);
    expect(res.body).toMatchObject({
      name: 'rage-api',
      apiVersion: 'v1',
      environment: 'test',
      features: {
        steamAuth: { status: 'unconfigured' },
        cs2Integration: { status: 'not_implemented' },
      },
    });
  });

  it('unknown routes return the normalized 404 envelope with a request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('echoes a safe x-request-id and replaces an unsafe one', async () => {
    const ok = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-request-id', 'trace-abc_123');
    expect(ok.headers['x-request-id']).toBe('trace-abc_123');
    const bad = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-request-id', 'evil value with spaces');
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/meta');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS: allows the configured web origin with credentials, ignores others', async () => {
    const allowed = await request(app.getHttpServer())
      .options('/api/v1/teams')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(app.getHttpServer())
      .get('/api/v1/meta')
      .set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('validation failures return 400 with field details', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/teams?pageSize=101&page=0');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Request validation failed');
    const fields = (res.body.details as { field: string }[]).map((d) => d.field).sort();
    expect(fields).toEqual(['page', 'pageSize']);
  });

  it('rejects unknown query parameters (whitelist)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/teams?admin=true');
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('admin');
  });

  it('serves the OpenAPI document when docs are enabled', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/health/live',
        '/api/v1/health/ready',
        '/api/v1/meta',
        '/api/v1/players',
        '/api/v1/players/{slug}',
        '/api/v1/teams',
        '/api/v1/teams/{slug}',
        '/api/v1/tournaments',
        '/api/v1/tournaments/{slug}',
        '/api/v1/matches',
        '/api/v1/matches/{id}',
      ]),
    );
  });
});

describe('rate limiting', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp({ RATE_LIMIT_PER_MINUTE: '3' });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('returns 429 envelope after the limit; health probes are exempt', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 3; i++) await request(server).get('/api/v1/meta').expect(200);
    const limited = await request(server).get('/api/v1/meta');
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
    for (let i = 0; i < 5; i++) await request(server).get('/api/v1/health/live').expect(200);
  });
});

describe('readiness when dependencies are down', () => {
  it('reports redis DOWN with 503 (app still serves liveness)', async () => {
    const app = await createTestApp({ REDIS_URL: 'redis://127.0.0.1:1' });
    try {
      const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        status: 'error',
        checks: { database: { status: 'up' }, redis: { status: 'down' } },
      });
      await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    } finally {
      await app.close();
    }
  });

  it('reports database DOWN with 503 without leaking connection details', async () => {
    const app = await createTestApp({
      DATABASE_URL: 'postgresql://nobody:topsecret@127.0.0.1:1/none',
    });
    try {
      const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
      expect(res.status).toBe(503);
      expect(res.body.checks.database.status).toBe('down');
      expect(JSON.stringify(res.body)).not.toContain('topsecret');

      // Data endpoints fail closed with an opaque 500, not a stack trace.
      const list = await request(app.getHttpServer()).get('/api/v1/teams');
      expect(list.status).toBe(500);
      expect(list.body.message).toBe('Internal server error');
      expect(JSON.stringify(list.body)).not.toContain('topsecret');
    } finally {
      await app.close();
    }
  });
});

import { describe, expect, it, vi } from 'vitest';
import { apiGet, apiSend, buildUrl, parseRetryAfter } from './http';

const BASE = 'http://api.test/api/v1';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function mockFetch(impl: () => Promise<Response>) {
  return vi.fn(impl) as unknown as typeof fetch;
}

describe('buildUrl', () => {
  it('joins base + path and drops empty query values', () => {
    expect(buildUrl(`${BASE}/`, '/teams', { page: 2, q: '', status: undefined })).toBe(
      `${BASE}/teams?page=2`,
    );
  });
});

describe('apiGet error mapping', () => {
  it('returns data on 200', async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }),
    );
    const result = await apiGet('/teams', { baseUrl: BASE, fetchImpl });
    expect(result).toEqual({ ok: true, data: { items: [], page: 1, pageSize: 20, total: 0 } });
  });

  it('maps 404 to not_found', async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(404, {
        statusCode: 404,
        error: 'Not Found',
        message: 'Team not found',
        requestId: 'req-1',
      }),
    );
    const result = await apiGet('/teams/nope', { baseUrl: BASE, fetchImpl });
    expect(result).toMatchObject({ ok: false, kind: 'not_found', status: 404, requestId: 'req-1' });
  });

  it('maps a network error to unavailable', async () => {
    const fetchImpl = mockFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const result = await apiGet('/teams', { baseUrl: BASE, fetchImpl });
    expect(result).toMatchObject({ ok: false, kind: 'unavailable' });
  });

  it('maps a timeout to unavailable', async () => {
    const fetchImpl = mockFetch(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    const result = await apiGet('/teams', { baseUrl: BASE, fetchImpl });
    expect(result).toMatchObject({ ok: false, kind: 'unavailable' });
  });

  it('maps 500 to error without leaking server messages', async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(
        500,
        { statusCode: 500, error: 'Internal', message: 'at Foo.bar (/srv/secret.ts:1:1)' },
        { 'x-request-id': 'hdr-9' },
      ),
    );
    const result = await apiGet('/teams', { baseUrl: BASE, fetchImpl });
    expect(result).toMatchObject({ ok: false, kind: 'error', status: 500, requestId: 'hdr-9' });
    if (!result.ok) expect(result.message).not.toContain('secret');
  });

  it('maps 503 to unavailable unless the status is explicitly accepted', async () => {
    const body = {
      status: 'error',
      checks: { database: { status: 'down' }, redis: { status: 'up' } },
    };
    const fetchImpl = mockFetch(async () => jsonResponse(503, body));
    expect(await apiGet('/health/ready', { baseUrl: BASE, fetchImpl })).toMatchObject({
      ok: false,
      kind: 'unavailable',
    });
    expect(
      await apiGet('/health/ready', { baseUrl: BASE, fetchImpl, acceptStatuses: [503] }),
    ).toEqual({ ok: true, data: body });
  });

  it('maps an invalid JSON body to error', async () => {
    const fetchImpl = mockFetch(async () => new Response('<html>', { status: 200 }));
    const result = await apiGet('/teams', { baseUrl: BASE, fetchImpl });
    expect(result).toMatchObject({ ok: false, kind: 'error' });
  });

  it('requests with no-store caching and a timeout signal', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    await apiGet('/meta', { baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch });
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe(`${BASE}/meta`);
    expect(call[1].cache).toBe('no-store');
    expect(call[1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('apiSend status mapping (M1)', () => {
  it('maps 429 to rate_limited with Retry-After seconds', async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(
        429,
        { statusCode: 429, message: 'ThrottlerException' },
        { 'retry-after': '30' },
      ),
    );
    const result = await apiGet('/teams', { baseUrl: BASE, fetchImpl });
    expect(result).toMatchObject({
      ok: false,
      kind: 'rate_limited',
      status: 429,
      retryAfterSeconds: 30,
    });
  });

  it('maps 429 without Retry-After (no retryAfterSeconds)', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(429, {}));
    const result = await apiGet('/teams', { baseUrl: BASE, fetchImpl });
    expect(result).toMatchObject({ ok: false, kind: 'rate_limited' });
    if (!result.ok) expect(result.retryAfterSeconds).toBeUndefined();
  });

  it('parses Retry-After as seconds or HTTP date', () => {
    const now = Date.parse('2026-11-12T10:00:00Z');
    expect(parseRetryAfter('5', now)).toBe(5);
    expect(parseRetryAfter('Thu, 12 Nov 2026 10:00:20 GMT', now)).toBe(20);
    expect(parseRetryAfter('Thu, 12 Nov 2026 09:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  it('maps 401 / 403', async () => {
    expect(
      await apiGet('/me', {
        baseUrl: BASE,
        fetchImpl: mockFetch(async () => jsonResponse(401, {})),
      }),
    ).toMatchObject({ ok: false, kind: 'unauthenticated', status: 401 });
    expect(
      await apiGet('/admin/users', {
        baseUrl: BASE,
        fetchImpl: mockFetch(async () => jsonResponse(403, { message: 'CSRF validation failed' })),
      }),
    ).toMatchObject({ ok: false, kind: 'forbidden', status: 403 });
  });

  it('maps 400 to validation with bounded details and the safe server message', async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(400, {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        requestId: 'r-1',
        details: [{ field: 'nickname', message: 'too short' }, { bogus: true }, 'x'],
      }),
    );
    const result = await apiSend('/me/profile', {
      method: 'PATCH',
      baseUrl: BASE,
      body: {},
      fetchImpl,
    });
    expect(result).toEqual({
      ok: false,
      kind: 'validation',
      status: 400,
      requestId: 'r-1',
      message: 'The request was rejected by validation.',
      serverMessage: 'Validation failed',
      details: [{ field: 'nickname', message: 'too short' }],
    });
  });

  it('maps 409 to conflict with the server message', async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(409, { statusCode: 409, message: 'Role already granted' }),
    );
    const result = await apiSend('/admin/users/x/roles', {
      method: 'POST',
      baseUrl: BASE,
      body: {},
      fetchImpl,
    });
    expect(result).toMatchObject({
      ok: false,
      kind: 'conflict',
      serverMessage: 'Role already granted',
    });
  });

  it('treats 204 as success with null data', async () => {
    const fetchImpl = mockFetch(async () => new Response(null, { status: 204 }));
    expect(await apiSend('/auth/logout', { method: 'POST', baseUrl: BASE, fetchImpl })).toEqual({
      ok: true,
      data: null,
    });
  });

  it('sends method, JSON body, extra headers and credentials', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    await apiSend('/me/profile', {
      method: 'PATCH',
      baseUrl: BASE,
      body: { nickname: 'Neo' },
      headers: { 'x-csrf-token': 'abc' },
      credentials: 'include',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe('{"nickname":"Neo"}');
    expect(init.credentials).toBe('include');
    expect(init.headers).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf-token': 'abc',
    });
  });
});

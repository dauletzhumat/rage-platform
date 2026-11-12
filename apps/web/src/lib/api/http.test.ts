import { describe, expect, it, vi } from 'vitest';
import { apiGet, buildUrl } from './http';

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

import { describe, expect, it, vi } from 'vitest';
import { grantRole, logout, revokeRole, updateProfile } from './browser';
import { steamSignInUrl } from './public-url';

const CSRF = 'c'.repeat(43);
const USER = '0195f1d2-0000-7000-8000-000000000001';
const GRANT = '0195f1d2-0000-7000-8000-000000000002';

function spy(status = 200, body: unknown = {}) {
  return vi.fn(async () =>
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
  );
}

function call(fetchSpy: ReturnType<typeof spy>, index = 0) {
  return fetchSpy.mock.calls[index] as unknown as [string, RequestInit];
}

describe('browser mutations', () => {
  it('logout POSTs with credentials and the CSRF header from rage_csrf', async () => {
    const fetchSpy = spy(204);
    const result = await logout({
      fetchImpl: fetchSpy as unknown as typeof fetch,
      cookieString: `NEXT_LOCALE=en; rage_csrf=${CSRF}`,
    });
    expect(result).toEqual({ ok: true, data: null });
    const [url, init] = call(fetchSpy);
    expect(url).toMatch(/\/api\/v1\/auth\/logout$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe(CSRF);
  });

  it('omits the CSRF header when the cookie is missing (the API then rejects)', async () => {
    const fetchSpy = spy(403, { message: 'CSRF validation failed' });
    const result = await logout({
      fetchImpl: fetchSpy as unknown as typeof fetch,
      cookieString: '',
    });
    expect(result).toMatchObject({ ok: false, kind: 'forbidden' });
    expect(call(fetchSpy)[1].headers).not.toHaveProperty('x-csrf-token');
  });

  it('updateProfile PATCHes JSON', async () => {
    const fetchSpy = spy(200, { profile: {} });
    await updateProfile(
      { nickname: 'Neo', countryCode: null, biography: null },
      { fetchImpl: fetchSpy as unknown as typeof fetch, cookieString: `rage_csrf=${CSRF}` },
    );
    const [url, init] = call(fetchSpy);
    expect(url).toMatch(/\/me\/profile$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      nickname: 'Neo',
      countryCode: null,
      biography: null,
    });
  });

  it('grant / revoke build the documented paths and refuse malformed ids without a request', async () => {
    const fetchSpy = spy(201, {});
    const options = {
      fetchImpl: fetchSpy as unknown as typeof fetch,
      cookieString: `rage_csrf=${CSRF}`,
    };
    await grantRole(USER, { role: 'OBSERVER', scopeType: 'GLOBAL', reason: 'needed' }, options);
    expect(call(fetchSpy)[0]).toMatch(new RegExp(`/admin/users/${USER}/roles$`));
    await revokeRole(USER, GRANT, { reason: 'done' }, options);
    expect(call(fetchSpy, 1)[0]).toMatch(new RegExp(`/admin/users/${USER}/roles/${GRANT}/revoke$`));

    expect(
      await grantRole('../meta', { role: 'OBSERVER', scopeType: 'GLOBAL', reason: 'x' }, options),
    ).toMatchObject({
      ok: false,
      kind: 'not_found',
    });
    expect(await revokeRole(USER, '..', { reason: 'x' }, options)).toMatchObject({ ok: false });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('maps a revoke 409 to conflict', async () => {
    const fetchSpy = spy(409, { message: 'Cannot revoke your own last SUPER_ADMIN grant' });
    const result = await revokeRole(
      USER,
      GRANT,
      { reason: 'test' },
      {
        fetchImpl: fetchSpy as unknown as typeof fetch,
        cookieString: `rage_csrf=${CSRF}`,
      },
    );
    expect(result).toMatchObject({ ok: false, kind: 'conflict' });
  });
});

describe('steamSignInUrl', () => {
  it('points at /auth/steam with a sanitised returnTo', () => {
    expect(steamSignInUrl('/me')).toMatch(/\/api\/v1\/auth\/steam\?returnTo=%2Fme$/);
    expect(steamSignInUrl('//evil.com')).toMatch(/\/api\/v1\/auth\/steam\?returnTo=%2F$/);
    expect(steamSignInUrl(undefined)).toMatch(/returnTo=%2F$/);
  });
});

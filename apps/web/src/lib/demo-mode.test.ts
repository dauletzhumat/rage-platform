import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSampleMutationsEnabled, sampleActionsAllowed } from './demo-mode';

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const { getDemoMode } = await import('./api/server');

function meta(status: unknown) {
  return {
    name: 'rage-api',
    apiVersion: 'v1',
    environment: 'development',
    version: '0.0.0',
    features: {
      steamAuth: { status: 'configured' },
      cs2Integration: { status: 'not_implemented' },
      sampleMutations: { status },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('demo mode flag', () => {
  it('is enabled only for an ok /meta with sampleMutations.status = enabled', () => {
    expect(isSampleMutationsEnabled({ ok: true, data: meta('enabled') as never })).toBe(true);
    expect(isSampleMutationsEnabled({ ok: true, data: meta('disabled') as never })).toBe(false);
    expect(isSampleMutationsEnabled({ ok: true, data: meta('ENABLED') as never })).toBe(false);
    expect(
      isSampleMutationsEnabled({ ok: true, data: { ...meta('enabled'), features: {} } as never }),
    ).toBe(false);
    expect(isSampleMutationsEnabled({ ok: false, kind: 'unavailable', message: '' })).toBe(false);
  });

  it('sample items accept actions only in demo mode; real items always', () => {
    expect(sampleActionsAllowed(false, false)).toBe(true);
    expect(sampleActionsAllowed(false, true)).toBe(true);
    expect(sampleActionsAllowed(true, false)).toBe(false);
    expect(sampleActionsAllowed(true, true)).toBe(true);
  });

  it.each([
    ['enabled', () => new Response(JSON.stringify(meta('enabled')), { status: 200 }), true],
    ['disabled', () => new Response(JSON.stringify(meta('disabled')), { status: 200 }), false],
    ['API down', () => Promise.reject(new TypeError('offline')), false],
  ])('getDemoMode reads /meta without the session (%s)', async (_n, response, expected) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => response());
    vi.stubGlobal('fetch', fetchSpy);
    expect(await getDemoMode()).toBe(expected);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/v1/meta');
    expect(init.headers).not.toHaveProperty('cookie');
  });
});

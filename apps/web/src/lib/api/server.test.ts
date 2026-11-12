import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMatch, getPlayer, getTeam, getTournament } from './server';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('route param validation before upstream fetch (security LOW-7)', () => {
  it.each(['.', '..', '../meta', 'UPPER', 'has space', '%2e%2e', '', 'a'.repeat(65)])(
    'slug %j → not_found without any request',
    async (slug) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      for (const getter of [getPlayer, getTeam, getTournament]) {
        const result = await getter(slug);
        expect(result).toMatchObject({ ok: false, kind: 'not_found' });
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each(['..', 'not-a-uuid', '0195f1d2-0000-7000-8000-00000000000'])(
    'match id %j → not_found without any request',
    async (id) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      expect(await getMatch(id)).toMatchObject({ ok: false, kind: 'not_found' });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('valid slugs are fetched from the configured API path', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ slug: 'sample-falcons' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const result = await getTeam('sample-falcons');
    expect(result.ok).toBe(true);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toMatch(/\/api\/v1\/teams\/sample-falcons$/);
  });
});

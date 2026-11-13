import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Incoming request seen by server components (mocked `next/headers`). */
const incoming = vi.hoisted(() => ({
  headers: {} as Record<string, string>,
  cookies: {} as Record<string, string>,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(incoming.headers),
  cookies: async () => ({
    get: (name: string) =>
      name in incoming.cookies ? { name, value: incoming.cookies[name] } : undefined,
  }),
}));

const {
  getAdminTeamApplications,
  getMyInvitations,
  getMyTeamApplications,
  getTeamManage,
  getTeamRosterHistory,
} = await import('./server');

const SESSION = 's'.repeat(43);

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function stubFetch(response: () => Response = () => json(200, [])) {
  const fetchSpy = vi.fn(async () => response());
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

function url(fetchSpy: ReturnType<typeof vi.fn>, index = 0): URL {
  return new URL(String((fetchSpy.mock.calls[index] as unknown[])[0]));
}

function sentHeaders(fetchSpy: ReturnType<typeof vi.fn>, index = 0): Record<string, string> {
  return ((fetchSpy.mock.calls[index] as unknown[])[1] as RequestInit).headers as Record<
    string,
    string
  >;
}

beforeEach(() => {
  incoming.headers = {};
  incoming.cookies = {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('M2 session-required reads', () => {
  it.each([
    ['getMyTeamApplications', () => getMyTeamApplications()],
    ['getMyInvitations', () => getMyInvitations()],
    ['getAdminTeamApplications', () => getAdminTeamApplications()],
    ['getTeamManage', () => getTeamManage('nova')],
  ])('%s → unauthenticated WITHOUT a request when there is no session', async (_n, run) => {
    const fetchSpy = stubFetch();
    expect(await run()).toMatchObject({ ok: false, kind: 'unauthenticated' });
    incoming.cookies = { rage_session: 'bad token!' };
    expect(await run()).toMatchObject({ ok: false, kind: 'unauthenticated' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwards only rage_session (never the whole Cookie header)', async () => {
    incoming.cookies = { rage_session: SESSION, rage_csrf: 'c'.repeat(43), NEXT_LOCALE: 'kk' };
    incoming.headers = { cookie: `rage_session=${SESSION}; rage_csrf=${'c'.repeat(43)}` };
    const fetchSpy = stubFetch();
    await getMyTeamApplications();
    expect(url(fetchSpy).pathname).toBe('/api/v1/me/team-applications');
    expect(sentHeaders(fetchSpy).cookie).toBe(`rage_session=${SESSION}`);
  });

  it('getMyInvitations sends only a known status filter', async () => {
    incoming.cookies = { rage_session: SESSION };
    const fetchSpy = stubFetch();
    await getMyInvitations('DECLINED');
    expect(url(fetchSpy, 0).pathname).toBe('/api/v1/me/invitations');
    expect(url(fetchSpy, 0).searchParams.get('status')).toBe('DECLINED');
    await getMyInvitations('DROP TABLE' as never);
    expect(url(fetchSpy, 1).searchParams.has('status')).toBe(false);
  });

  it('getAdminTeamApplications passes status/page/pageSize and drops unknown statuses', async () => {
    incoming.cookies = { rage_session: SESSION };
    const fetchSpy = stubFetch(() => json(200, { items: [], page: 2, pageSize: 20, total: 0 }));
    await getAdminTeamApplications({ status: 'REJECTED', page: 2, pageSize: 20 });
    const first = url(fetchSpy, 0);
    expect(first.pathname).toBe('/api/v1/admin/team-applications');
    expect(Object.fromEntries(first.searchParams)).toEqual({
      status: 'REJECTED',
      page: '2',
      pageSize: '20',
    });
    await getAdminTeamApplications({ status: 'whatever' as never });
    expect(url(fetchSpy, 1).searchParams.has('status')).toBe(false);
    expect(sentHeaders(fetchSpy, 1).cookie).toBe(`rage_session=${SESSION}`);
  });

  it('getTeamManage validates the slug, forwards the session and maps 403', async () => {
    incoming.cookies = { rage_session: SESSION };
    const fetchSpy = stubFetch(() =>
      json(403, { statusCode: 403, code: 'FORBIDDEN_ROLE', message: 'nope' }),
    );
    expect(await getTeamManage('../admin')).toMatchObject({ ok: false, kind: 'not_found' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getTeamManage('nova')).toMatchObject({
      ok: false,
      kind: 'forbidden',
      code: 'FORBIDDEN_ROLE',
    });
    expect(url(fetchSpy).pathname).toBe('/api/v1/teams/nova/manage');
    expect(sentHeaders(fetchSpy).cookie).toBe(`rage_session=${SESSION}`);
  });
});

describe('M2 public reads', () => {
  it('getTeamRosterHistory NEVER forwards the session cookie', async () => {
    incoming.cookies = { rage_session: SESSION };
    const fetchSpy = stubFetch(() => json(200, { items: [], page: 1, pageSize: 10, total: 0 }));
    const result = await getTeamRosterHistory('nova', 3, 10);
    expect(result.ok).toBe(true);
    const sent = url(fetchSpy);
    expect(sent.pathname).toBe('/api/v1/teams/nova/roster-history');
    expect(sent.searchParams.get('page')).toBe('3');
    expect(sent.searchParams.get('pageSize')).toBe('10');
    expect(sentHeaders(fetchSpy)).not.toHaveProperty('cookie');
  });

  it.each(['..', 'UPPER', 'a b', '%2e%2e'])(
    'getTeamRosterHistory(%j) → not_found without a request',
    async (slug) => {
      const fetchSpy = stubFetch();
      expect(await getTeamRosterHistory(slug)).toMatchObject({ ok: false, kind: 'not_found' });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const incoming = vi.hoisted(() => ({
  cookies: {} as Record<string, string>,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name in incoming.cookies ? { name, value: incoming.cookies[name] } : undefined,
  }),
}));

const {
  getAdminMatches,
  getAdminRegistrations,
  getAdminTournament,
  getAdminTournaments,
  getBannedSteamIds,
  getMatch,
  getMatchVeto,
  getMyRegistrations,
  getTournament,
  getTournamentBracket,
  getTournamentTeams,
} = await import('./server');

const SESSION = 's'.repeat(43);
const ID = '0195f1d2-0000-7000-8000-000000000001';

function stubFetch(body: unknown = { items: [], page: 1, pageSize: 20, total: 0 }) {
  const fetchSpy = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

const url = (fetchSpy: ReturnType<typeof vi.fn>, i = 0) =>
  new URL(String((fetchSpy.mock.calls[i] as unknown[])[0]));
const sent = (fetchSpy: ReturnType<typeof vi.fn>, i = 0) =>
  ((fetchSpy.mock.calls[i] as unknown[])[1] as RequestInit).headers as Record<string, string>;

beforeEach(() => {
  incoming.cookies = { rage_session: SESSION };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('M3 public reads never forward the session', () => {
  it.each([
    ['getTournament', () => getTournament('winter-cup'), '/api/v1/tournaments/winter-cup'],
    [
      'getTournamentTeams',
      () => getTournamentTeams('winter-cup'),
      '/api/v1/tournaments/winter-cup/teams',
    ],
    [
      'getTournamentBracket',
      () => getTournamentBracket('winter-cup'),
      '/api/v1/tournaments/winter-cup/bracket',
    ],
    ['getMatch', () => getMatch(ID), `/api/v1/matches/${ID}`],
    ['getMatchVeto', () => getMatchVeto(ID), `/api/v1/matches/${ID}/veto`],
  ])('%s', async (_name, run, path) => {
    const fetchSpy = stubFetch({});
    await run();
    expect(url(fetchSpy).pathname).toBe(path);
    expect(sent(fetchSpy)).not.toHaveProperty('cookie');
  });

  it.each([
    () => getTournamentTeams('..'),
    () => getTournamentBracket('UPPER'),
    () => getMatchVeto('not-a-uuid'),
    () => getMatch('../admin'),
  ])('invalid identifiers → not_found without a request (%#)', async (run) => {
    const fetchSpy = stubFetch();
    expect(await run()).toMatchObject({ ok: false, kind: 'not_found' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('M3 admin matches', () => {
  it('GET /admin/matches with validated tournamentId/status and the session only', async () => {
    const fetchSpy = stubFetch();
    await getAdminMatches({ tournamentId: ID, status: 'CREATED', page: 2, pageSize: 20 });
    expect(url(fetchSpy).pathname).toBe('/api/v1/admin/matches');
    expect(Object.fromEntries(url(fetchSpy).searchParams)).toEqual({
      tournamentId: ID,
      status: 'CREATED',
      page: '2',
      pageSize: '20',
    });
    expect(sent(fetchSpy).cookie).toBe(`rage_session=${SESSION}`);
    await getAdminMatches({ tournamentId: '../x', status: 'KNIFE' as never });
    expect(Object.fromEntries(url(fetchSpy, 1).searchParams)).toEqual({});
  });

  it('getBannedSteamIds forwards the active filter only when boolean', async () => {
    const fetchSpy = stubFetch();
    await getBannedSteamIds({ active: false });
    expect(url(fetchSpy).searchParams.get('active')).toBe('false');
  });
});

describe('M3 session reads', () => {
  it.each([
    ['getMyRegistrations', () => getMyRegistrations()],
    ['getAdminTournaments', () => getAdminTournaments()],
    ['getAdminTournament', () => getAdminTournament(ID)],
    ['getAdminRegistrations', () => getAdminRegistrations(ID)],
    ['getBannedSteamIds', () => getBannedSteamIds()],
    ['getAdminMatches', () => getAdminMatches()],
  ])('%s → unauthenticated WITHOUT a request when there is no session', async (_n, run) => {
    incoming.cookies = {};
    const fetchSpy = stubFetch();
    expect(await run()).toMatchObject({ ok: false, kind: 'unauthenticated' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forward only rage_session to the documented paths', async () => {
    const fetchSpy = stubFetch();
    await getMyRegistrations();
    await getAdminTournament(ID);
    await getBannedSteamIds({ page: 2, pageSize: 50 });
    expect(url(fetchSpy, 0).pathname).toBe('/api/v1/me/registrations');
    expect(url(fetchSpy, 1).pathname).toBe(`/api/v1/admin/tournaments/${ID}`);
    expect(url(fetchSpy, 2).pathname).toBe('/api/v1/admin/banned-steam-ids');
    expect(Object.fromEntries(url(fetchSpy, 2).searchParams)).toEqual({
      page: '2',
      pageSize: '50',
    });
    for (const i of [0, 1, 2]) expect(sent(fetchSpy, i).cookie).toBe(`rage_session=${SESSION}`);
  });

  it('getAdminTournaments passes only known statuses (DRAFT allowed for admins)', async () => {
    const fetchSpy = stubFetch();
    await getAdminTournaments({ status: 'DRAFT', q: 'cup', page: 3 });
    expect(Object.fromEntries(url(fetchSpy, 0).searchParams)).toEqual({
      status: 'DRAFT',
      q: 'cup',
      page: '3',
    });
    await getAdminTournaments({ status: 'NOPE' as never });
    expect(url(fetchSpy, 1).searchParams.has('status')).toBe(false);
  });

  it('getAdminRegistrations validates the tournament id and status filter', async () => {
    const fetchSpy = stubFetch();
    expect(await getAdminRegistrations('../x')).toMatchObject({ kind: 'not_found' });
    expect(fetchSpy).not.toHaveBeenCalled();
    await getAdminRegistrations(ID, { status: 'APPROVED', pageSize: 100 });
    expect(url(fetchSpy).pathname).toBe(`/api/v1/admin/tournaments/${ID}/registrations`);
    expect(url(fetchSpy).searchParams.get('status')).toBe('APPROVED');
    expect(url(fetchSpy).searchParams.get('pageSize')).toBe('100');
    await getAdminRegistrations(ID, { status: 'DROP' as never });
    expect(url(fetchSpy, 1).searchParams.has('status')).toBe(false);
  });
});

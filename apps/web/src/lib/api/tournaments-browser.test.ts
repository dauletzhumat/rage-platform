import { describe, expect, it, vi } from 'vitest';
import {
  approveRegistration,
  banSteamId,
  changeTournamentStatus,
  createRegistration,
  createTournament,
  forfeitMatch,
  generateBracket,
  liftSteamBan,
  overrideMatchResult,
  rejectRegistration,
  setTournamentSeeds,
  submitVeto,
  substituteRegistrationPlayer,
  updateRegistrationRoster,
  updateTournament,
  withdrawRegistration,
  type MutationOptions,
} from './browser';
import type { CreateTournamentDto } from './types';

const CSRF = 'c'.repeat(43);
const T = '0195f1d2-0000-7000-8000-000000000001';
const R = '0195f1d2-0000-7000-8000-000000000002';
const TEAM = '0195f1d2-0000-7000-8000-000000000003';
const U1 = '0195f1d2-0000-7000-8000-000000000011';
const U2 = '0195f1d2-0000-7000-8000-000000000012';
const M = '0195f1d2-0000-7000-8000-000000000004';
const KEY = /^[A-Za-z0-9_-]{16,64}$/;

const players = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `0195f1d2-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`,
  );

function respond(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body ?? {}), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });
}

function spy(...responses: Array<Response | Error>) {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift() ?? respond(200, {});
    if (next instanceof Error) throw next;
    return next;
  });
}

function opts(fetchSpy: ReturnType<typeof spy>): MutationOptions {
  return {
    fetchImpl: fetchSpy as unknown as typeof fetch,
    cookieString: `rage_csrf=${CSRF}`,
    sleep: vi.fn(async () => {}),
  };
}

function call(fetchSpy: ReturnType<typeof spy>, index = 0) {
  const [url, init] = fetchSpy.mock.calls[index] as unknown as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

const TOURNAMENT: CreateTournamentDto = {
  name: 'Winter Cup',
  format: 'SINGLE_ELIMINATION',
  defaultMatchFormat: 'BO3',
  finalMatchFormat: 'BO5',
  maxTeams: 8,
  mapPool: ['de_alpha', 'de_bravo', 'de_charlie', 'de_delta', 'de_echo', 'de_foxtrot', 'de_golf'],
};

describe('M3 browser mutations: documented methods, paths and bodies', () => {
  const roster = { teamId: TEAM, starters: players(5), substitutes: players(7).slice(5) };
  it.each([
    [
      'register',
      (o: MutationOptions) => createRegistration(T, roster, o),
      'POST',
      `/tournaments/${T}/registrations`,
      roster,
    ],
    [
      'update roster',
      (o: MutationOptions) => updateRegistrationRoster(T, R, roster, o),
      'PUT',
      `/tournaments/${T}/registrations/${R}/roster`,
      roster,
    ],
    [
      'withdraw',
      (o: MutationOptions) => withdrawRegistration(T, R, o),
      'POST',
      `/tournaments/${T}/registrations/${R}/withdraw`,
      undefined,
    ],
    [
      'veto',
      (o: MutationOptions) => submitVeto(M, { action: 'BAN', mapName: 'de_alpha' }, o),
      'POST',
      `/matches/${M}/veto`,
      { action: 'BAN', mapName: 'de_alpha' },
    ],
    [
      'create tournament',
      (o: MutationOptions) => createTournament(TOURNAMENT, o),
      'POST',
      '/admin/tournaments',
      TOURNAMENT,
    ],
    [
      'edit tournament',
      (o: MutationOptions) => updateTournament(T, { maxTeams: 16 }, o),
      'PATCH',
      `/admin/tournaments/${T}`,
      { maxTeams: 16 },
    ],
    [
      'status',
      (o: MutationOptions) =>
        changeTournamentStatus(T, { to: 'CANCELLED', reason: 'venue lost' }, o),
      'POST',
      `/admin/tournaments/${T}/status`,
      { to: 'CANCELLED', reason: 'venue lost' },
    ],
    [
      'approve',
      (o: MutationOptions) => approveRegistration(T, R, { note: 'ok' }, o),
      'POST',
      `/admin/tournaments/${T}/registrations/${R}/approve`,
      { note: 'ok' },
    ],
    [
      'reject',
      (o: MutationOptions) => rejectRegistration(T, R, { reason: 'late' }, o),
      'POST',
      `/admin/tournaments/${T}/registrations/${R}/reject`,
      { reason: 'late' },
    ],
    [
      'substitute',
      (o: MutationOptions) =>
        substituteRegistrationPlayer(
          T,
          R,
          { outUserId: U1, inUserId: U2, role: 'STARTER', reason: 'illness' },
          o,
        ),
      'POST',
      `/admin/tournaments/${T}/registrations/${R}/substitute`,
      { outUserId: U1, inUserId: U2, role: 'STARTER', reason: 'illness' },
    ],
    [
      'seeds',
      (o: MutationOptions) => setTournamentSeeds(T, { seeds: [{ registrationId: R, seed: 1 }] }, o),
      'PUT',
      `/admin/tournaments/${T}/seeds`,
      { seeds: [{ registrationId: R, seed: 1 }] },
    ],
    [
      'generate bracket',
      (o: MutationOptions) => generateBracket(T, o),
      'POST',
      `/admin/tournaments/${T}/generate-bracket`,
      undefined,
    ],
    [
      'override',
      (o: MutationOptions) =>
        overrideMatchResult(
          M,
          { winnerTeamId: TEAM, teamAScore: 2, teamBScore: 1, reason: 'server down' },
          o,
        ),
      'POST',
      `/admin/matches/${M}/result-override`,
      { winnerTeamId: TEAM, teamAScore: 2, teamBScore: 1, reason: 'server down' },
    ],
    [
      'forfeit',
      (o: MutationOptions) => forfeitMatch(M, { forfeitingTeamId: TEAM, reason: 'no show' }, o),
      'POST',
      `/admin/matches/${M}/forfeit`,
      { forfeitingTeamId: TEAM, reason: 'no show' },
    ],
    [
      'ban',
      (o: MutationOptions) => banSteamId({ steamId64: '76561198000000001', reason: 'cheating' }, o),
      'POST',
      '/admin/banned-steam-ids',
      { steamId64: '76561198000000001', reason: 'cheating' },
    ],
    [
      'lift ban',
      (o: MutationOptions) => liftSteamBan(R, { reason: 'appeal' }, o),
      'POST',
      `/admin/banned-steam-ids/${R}/lift`,
      { reason: 'appeal' },
    ],
  ] as const)('%s', async (_name, run, method, path, body) => {
    const fetchSpy = spy(respond(200, {}));
    const result = await run(opts(fetchSpy));
    expect(result.ok).toBe(true);
    const { url, init, headers } = call(fetchSpy);
    expect(url.endsWith(`/api/v1${path}`)).toBe(true);
    expect(init.method).toBe(method);
    expect(init.credentials).toBe('include');
    expect(headers['x-csrf-token']).toBe(CSRF);
    expect(headers['Idempotency-Key']).toMatch(KEY);
    if (body === undefined) expect(init.body).toBeUndefined();
    else expect(JSON.parse(String(init.body))).toEqual(body);
  });
});

describe('M3 idempotency for PUT/PATCH', () => {
  it('retries a PUT once with the SAME key and method after a network error', async () => {
    const fetchSpy = spy(new TypeError('offline'), respond(200, {}));
    const result = await updateRegistrationRoster(
      T,
      R,
      { teamId: TEAM, starters: players(5), substitutes: [] },
      opts(fetchSpy),
    );
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(call(fetchSpy, 1).init.method).toBe('PUT');
    expect(call(fetchSpy, 0).headers['Idempotency-Key']).toBe(
      call(fetchSpy, 1).headers['Idempotency-Key'],
    );
  });

  it('does not retry business conflicts (e.g. VETO_NOT_YOUR_TURN)', async () => {
    const fetchSpy = spy(respond(409, { code: 'VETO_NOT_YOUR_TURN', message: 'no' }));
    const result = await submitVeto(M, { action: 'PICK', mapName: 'de_alpha' }, opts(fetchSpy));
    expect(result).toMatchObject({ ok: false, kind: 'conflict', code: 'VETO_NOT_YOUR_TURN' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps PLAYER_INELIGIBLE details for per-player errors', async () => {
    const fetchSpy = spy(
      respond(409, {
        code: 'PLAYER_INELIGIBLE',
        message: 'ineligible',
        details: [{ field: U1, message: 'BANNED' }],
      }),
    );
    const result = await createRegistration(
      T,
      { teamId: TEAM, starters: players(5), substitutes: [] },
      opts(fetchSpy),
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'PLAYER_INELIGIBLE',
      details: [{ field: U1, message: 'BANNED' }],
    });
  });
});

describe('M3 browser mutations refuse malformed ids without a request', () => {
  it('validates every path id (and body ids that become references)', async () => {
    const fetchSpy = spy();
    const o = opts(fetchSpy);
    const bad = '../admin';
    const results = await Promise.all([
      createRegistration(bad, { teamId: TEAM, starters: [], substitutes: [] }, o),
      createRegistration(T, { teamId: bad, starters: [], substitutes: [] }, o),
      updateRegistrationRoster(T, bad, { teamId: TEAM, starters: [], substitutes: [] }, o),
      withdrawRegistration(T, '%2e%2e', o),
      submitVeto('1', { action: 'BAN', mapName: 'de_a' }, o),
      updateTournament(bad, {}, o),
      changeTournamentStatus('', { to: 'REGISTRATION_OPEN' }, o),
      approveRegistration(bad, R, {}, o),
      rejectRegistration(T, bad, { reason: 'abc' }, o),
      substituteRegistrationPlayer(
        T,
        R,
        { outUserId: bad, inUserId: U2, role: 'STARTER', reason: 'abc' },
        o,
      ),
      setTournamentSeeds(T, { seeds: [{ registrationId: bad, seed: 1 }] }, o),
      generateBracket(bad, o),
      overrideMatchResult(M, { winnerTeamId: bad, teamAScore: 1, teamBScore: 0, reason: 'abc' }, o),
      forfeitMatch(bad, { forfeitingTeamId: TEAM, reason: 'abc' }, o),
      liftSteamBan(bad, { reason: 'abc' }, o),
    ]);
    for (const result of results) expect(result).toMatchObject({ ok: false, kind: 'not_found' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

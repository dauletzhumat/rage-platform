import { describe, expect, it } from 'vitest';
import type { MeDtoM2, VetoStateDto } from '@/lib/api/types';
import {
  canCreateTournament,
  isMatchAdminOf,
  isTournamentAdminOf,
  operatedTeamIds,
  operatedTeamSlugs,
} from './access';
import { isByeMatch, roundLabel, winnerSide } from './bracket';
import {
  canEditTournament,
  ineligiblePlayers,
  manualStatusTargets,
  selectionToLists,
  validateMapPool,
  validateRosterSelection,
  validateSeeds,
  validateSeriesScore,
  validateTournamentForm,
  type TournamentFormInput,
} from './validation';
import { mapStates, VETO_SEQUENCES, vetoTurn } from './veto';
import {
  DEFAULT_DISPLAY_TIMEZONE,
  isoToZonedInput,
  resolveDisplayTimeZone,
  resolveDisplayTimeZoneLabel,
  zonedInputToIso,
} from '@/lib/display-time';

const POOL = ['de_alpha', 'de_bravo', 'de_charlie', 'de_delta', 'de_echo', 'de_foxtrot', 'de_golf'];
const ids = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `0195f1d2-0000-7000-8000-0000000000${String(i).padStart(2, '0')}`,
  );

describe('validateMapPool', () => {
  it('accepts exactly 7 distinct valid names (trimmed, lower-cased)', () => {
    const result = validateMapPool([' DE_Alpha ', ...POOL.slice(1)]);
    expect(result).toEqual({ ok: true, value: POOL });
  });

  it('reports per-input errors: required, format, duplicate', () => {
    const result = validateMapPool([
      '',
      'mirage',
      'de_x',
      'de_bad-name',
      'de_alpha',
      'de_alpha',
      'de_ok_1',
    ]);
    expect(result).toEqual({
      ok: false,
      errors: ['mapRequired', 'mapFormat', 'mapFormat', 'mapFormat', null, 'mapDuplicate', null],
    });
  });

  it('rejects fewer than 7 (missing inputs are required) and more than 7', () => {
    expect(validateMapPool(POOL.slice(0, 6)).ok).toBe(false);
    expect(validateMapPool([...POOL, 'de_hotel']).ok).toBe(false);
  });

  it('enforces the 2–30 character suffix', () => {
    expect(validateMapPool([`de_${'a'.repeat(30)}`, ...POOL.slice(1)]).ok).toBe(true);
    expect(validateMapPool([`de_${'a'.repeat(31)}`, ...POOL.slice(1)]).ok).toBe(false);
  });
});

describe('validateTournamentForm', () => {
  const base: TournamentFormInput = {
    name: 'Winter Cup',
    defaultMatchFormat: 'BO3',
    finalMatchFormat: '',
    maxTeams: '16',
    registrationOpenAt: '2026-12-01T10:00',
    registrationCloseAt: '2026-12-05T18:30',
    startsAt: '',
    description: '',
    mapPool: POOL,
  };

  it('builds a single-elimination body with UTC times and nulls for empty optionals', () => {
    const result = validateTournamentForm(base);
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Winter Cup',
        format: 'SINGLE_ELIMINATION',
        defaultMatchFormat: 'BO3',
        finalMatchFormat: null,
        maxTeams: 16,
        // Entered in UTC+5 → sent as UTC instants.
        registrationOpenAt: '2026-12-01T05:00:00.000Z',
        registrationCloseAt: '2026-12-05T13:30:00.000Z',
        startsAt: null,
        description: null,
        mapPool: POOL,
      },
    });
  });

  it('flags name, maxTeams, window order, formats and the map pool', () => {
    const result = validateTournamentForm({
      ...base,
      name: 'ab',
      maxTeams: '65',
      defaultMatchFormat: 'BO7',
      registrationCloseAt: '2026-11-30T10:00',
      mapPool: ['', '', '', '', '', '', ''],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject({
      name: 'nameLength',
      maxTeams: 'maxTeamsRange',
      defaultMatchFormat: 'formatRequired',
      registrationCloseAt: 'closeBeforeOpen',
      mapPool: 'mapPoolInvalid',
    });
    expect(result.mapErrors.every((e) => e === 'mapRequired')).toBe(true);
  });

  it('rejects bidi/control characters in the description', () => {
    const result = validateTournamentForm({ ...base, description: 'hi‮there' });
    expect(result.ok ? null : result.errors.description).toBe('descriptionChars');
  });
});

describe('display time zone (UTC+5) conversions', () => {
  it('defaults to Etc/GMT-5 (UTC+5) and validates configuration', () => {
    expect(DEFAULT_DISPLAY_TIMEZONE).toBe('Etc/GMT-5');
    expect(resolveDisplayTimeZone(undefined)).toBe('Etc/GMT-5');
    expect(resolveDisplayTimeZone('Not/AZone')).toBe('Etc/GMT-5');
    expect(resolveDisplayTimeZone('Asia/Almaty')).toBe('Asia/Almaty');
    expect(resolveDisplayTimeZoneLabel(undefined)).toBe('UTC+5');
    expect(resolveDisplayTimeZoneLabel('<b>')).toBe('UTC+5');
  });

  it('input (UTC+5) → ISO instant with explicit offset', () => {
    expect(zonedInputToIso('2026-11-15T20:59')).toBe('2026-11-15T15:59:00.000Z');
    expect(zonedInputToIso('2026-11-15T20:59:30')).toBe('2026-11-15T15:59:30.000Z');
    // Day boundaries: local early morning is the previous UTC day; year rollover.
    expect(zonedInputToIso('2026-12-01T03:00')).toBe('2026-11-30T22:00:00.000Z');
    expect(zonedInputToIso('2027-01-01T00:00')).toBe('2026-12-31T19:00:00.000Z');
    expect(zonedInputToIso('2026-03-01T04:59')).toBe('2026-02-28T23:59:00.000Z');
  });

  it('ISO → input (UTC+5), incl. day boundaries, and round-trips', () => {
    expect(isoToZonedInput('2026-11-15T15:59:00.000Z')).toBe('2026-11-15T20:59');
    expect(isoToZonedInput('2026-11-30T19:00:00Z')).toBe('2026-12-01T00:00');
    expect(isoToZonedInput('2026-12-31T22:30:00Z')).toBe('2027-01-01T03:30');
    expect(isoToZonedInput('2026-11-15T20:59:00+05:00')).toBe('2026-11-15T20:59');
    expect(isoToZonedInput(null)).toBe('');
    expect(isoToZonedInput('garbage')).toBe('');
    for (const v of ['2026-01-01T00:00', '2026-06-30T23:59', '2028-02-29T12:00']) {
      expect(isoToZonedInput(zonedInputToIso(v))).toBe(v);
    }
  });

  it('rejects malformed and impossible dates', () => {
    expect(zonedInputToIso('2026-02-30T10:00')).toBeUndefined();
    expect(zonedInputToIso('2026-13-01T10:00')).toBeUndefined();
    expect(zonedInputToIso('2026-01-01T24:00')).toBeUndefined();
    expect(zonedInputToIso('garbage')).toBeUndefined();
    expect(zonedInputToIso('')).toBeNull();
  });

  it('works for other zones, e.g. UTC and a DST zone', () => {
    expect(zonedInputToIso('2026-11-15T20:59', 'UTC')).toBe('2026-11-15T20:59:00.000Z');
    expect(zonedInputToIso('2026-07-01T12:00', 'Europe/Berlin')).toBe('2026-07-01T10:00:00.000Z');
    expect(isoToZonedInput('2026-01-01T12:00:00Z', 'Europe/Berlin')).toBe('2026-01-01T13:00');
  });
});

describe('status transitions', () => {
  it('offers only manual transitions (IN_PROGRESS via bracket, COMPLETED via final)', () => {
    expect(manualStatusTargets('DRAFT')).toEqual(['REGISTRATION_OPEN', 'CANCELLED']);
    expect(manualStatusTargets('REGISTRATION_OPEN')).toEqual(['REGISTRATION_CLOSED', 'CANCELLED']);
    expect(manualStatusTargets('REGISTRATION_CLOSED')).toEqual(['CANCELLED']);
    expect(manualStatusTargets('IN_PROGRESS')).toEqual(['CANCELLED']);
    expect(manualStatusTargets('COMPLETED')).toEqual([]);
    expect(manualStatusTargets('CANCELLED')).toEqual([]);
    expect(canEditTournament('DRAFT')).toBe(true);
    expect(canEditTournament('REGISTRATION_CLOSED')).toBe(false);
  });
});

describe('roster selection (5 starters + ≤ 2 substitutes)', () => {
  const team = ids(1)[0]!;
  it('accepts 5 + 0, 5 + 2', () => {
    expect(validateRosterSelection(team, ids(5), []).ok).toBe(true);
    expect(validateRosterSelection(team, ids(5), ids(7).slice(5)).ok).toBe(true);
  });

  it('rejects wrong starter counts, too many subs, duplicates and overlap', () => {
    expect(validateRosterSelection(team, ids(4), [])).toEqual({
      ok: false,
      errors: ['startersCount'],
    });
    expect(validateRosterSelection(team, ids(6), [])).toEqual({
      ok: false,
      errors: ['startersCount'],
    });
    expect(validateRosterSelection(team, ids(5), ids(8).slice(5))).toEqual({
      ok: false,
      errors: ['substitutesMax'],
    });
    const [a] = ids(1);
    expect(validateRosterSelection(team, [...ids(4), a!], []).ok).toBe(false);
    expect(validateRosterSelection(team, ids(5), [ids(5)[0]!])).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['overlap']),
    });
  });

  it('selectionToLists preserves roster order', () => {
    const [a, b, c] = ids(3) as [string, string, string];
    expect(selectionToLists([a, b, c], { [a]: 'SUBSTITUTE', [b]: 'STARTER', [c]: 'NONE' })).toEqual(
      { starters: [b], substitutes: [a] },
    );
  });
});

describe('ineligiblePlayers', () => {
  const [a, b] = ids(2) as [string, string];
  it('maps PLAYER_INELIGIBLE details to known reasons; unknown → UNKNOWN; junk ignored', () => {
    expect(
      ineligiblePlayers({
        code: 'PLAYER_INELIGIBLE',
        details: [
          { field: a, message: 'BANNED' },
          { field: b, message: '<b>evil</b>' },
          { field: 'starters.0', message: 'SAMPLE' },
        ],
      }),
    ).toEqual({ [a]: 'BANNED', [b]: 'UNKNOWN' });
  });

  it('ignores other codes', () => {
    expect(
      ineligiblePlayers({ code: 'ROSTER_INVALID', details: [{ field: a, message: 'BANNED' }] }),
    ).toEqual({});
    expect(ineligiblePlayers(null)).toEqual({});
  });
});

describe('validateSeeds', () => {
  const [a, b, c] = ids(3) as [string, string, string];
  it('requires unique seeds 1..N covering every registration', () => {
    expect(validateSeeds([a, b, c], { [a]: '2', [b]: '1', [c]: '3' })).toEqual({
      ok: true,
      value: [
        { registrationId: b, seed: 1 },
        { registrationId: a, seed: 2 },
        { registrationId: c, seed: 3 },
      ],
    });
    expect(validateSeeds([a, b, c], { [a]: '1', [b]: '1', [c]: '' })).toEqual({
      ok: false,
      errors: { [b]: 'seedDuplicate', [c]: 'seedRequired' },
    });
    expect(validateSeeds([a, b], { [a]: '0', [b]: '3' })).toEqual({
      ok: false,
      errors: { [a]: 'seedRange', [b]: 'seedRange' },
    });
  });
});

describe('validateSeriesScore (maps won per format)', () => {
  it.each([
    ['BO1', 'A', '1', '0'],
    ['BO3', 'A', '2', '0'],
    ['BO3', 'B', '1', '2'],
    ['BO5', 'A', '3', '2'],
    ['BO5', 'B', '0', '3'],
  ] as const)('%s winner %s %s–%s is valid', (format, winner, a, b) => {
    expect(validateSeriesScore(format, winner, a, b)).toEqual({
      ok: true,
      teamAScore: Number(a),
      teamBScore: Number(b),
    });
  });

  it.each([
    ['BO1', 'A', '2', '0', 'scoreInvalid'],
    ['BO3', 'A', '1', '0', 'scoreInvalid'],
    ['BO3', 'A', '2', '2', 'scoreInvalid'],
    ['BO5', 'A', '3', '3', 'scoreInvalid'],
    ['BO5', 'A', '4', '0', 'scoreInvalid'],
    ['BO3', 'A', '0', '2', 'winnerMismatch'],
    ['BO3', null, '2', '0', 'scoreRequired'],
    ['BO3', 'A', '', '0', 'scoreRequired'],
    ['BO3', 'A', '-1', '2', 'scoreInvalid'],
  ] as const)('%s winner %s %s–%s → %s', (format, winner, a, b, error) => {
    expect(validateSeriesScore(format, winner, a, b)).toEqual({ ok: false, error });
  });
});

describe('veto', () => {
  const A = ids(2)[0]!;
  const B = ids(2)[1]!;
  const base: VetoStateDto = {
    pool: POOL,
    actions: [],
    next: { teamId: A, action: 'BAN' },
    remaining: POOL,
    complete: false,
  };

  it('has the documented sequences (team A starts; 6 steps + decider)', () => {
    const fmt = (f: 'BO1' | 'BO3' | 'BO5') =>
      VETO_SEQUENCES[f].map((s) => `${s.team}${s.action[0]}`).join(' ');
    expect(fmt('BO1')).toBe('AB BB AB BB AB BB');
    expect(fmt('BO3')).toBe('AB BB AP BP AB BB');
    expect(fmt('BO5')).toBe('AB BB AP BP AP BP');
  });

  it('lets only the operator of the acting team act, while the match is open', () => {
    const teams = { teamAId: A, teamBId: B };
    expect(vetoTurn(base, teams, new Set([A]), true)).toMatchObject({
      actingSide: 'A',
      action: 'BAN',
      viewerCanAct: true,
      stepIndex: 0,
    });
    expect(vetoTurn(base, teams, new Set([B]), true).viewerCanAct).toBe(false);
    expect(vetoTurn(base, teams, new Set([A]), false).viewerCanAct).toBe(false);
    expect(vetoTurn(base, { teamAId: A, teamBId: null }, new Set([A]), true).viewerCanAct).toBe(
      false,
    );
  });

  it('lets SUPER_ADMIN act as an audited override (flagged), never when the match is closed', () => {
    const teams = { teamAId: A, teamBId: B };
    expect(vetoTurn(base, teams, new Set(), true, true)).toMatchObject({
      viewerCanAct: true,
      asOverride: true,
    });
    expect(vetoTurn(base, teams, new Set([A]), true, true)).toMatchObject({
      viewerCanAct: true,
      asOverride: false,
    });
    expect(vetoTurn(base, teams, new Set(), false, true).viewerCanAct).toBe(false);
  });

  it('follows the API turn (never infers one) and reports completion', () => {
    const state: VetoStateDto = {
      ...base,
      actions: [
        { sequence: 1, teamId: A, action: 'BAN', mapName: 'de_alpha', createdAt: '' },
        { sequence: 2, teamId: B, action: 'BAN', mapName: 'de_bravo', createdAt: '' },
      ],
      next: { teamId: A, action: 'PICK' },
    };
    expect(vetoTurn(state, { teamAId: A, teamBId: B }, new Set([A]), true)).toMatchObject({
      action: 'PICK',
      stepIndex: 2,
    });
    const done = { ...state, next: null, complete: true };
    expect(vetoTurn(done, { teamAId: A, teamBId: B }, new Set([A, B]), true)).toMatchObject({
      complete: true,
      viewerCanAct: false,
    });
    const unknown = { ...state, next: { teamId: ids(3)[2]!, action: 'BAN' as const } };
    expect(
      vetoTurn(unknown, { teamAId: A, teamBId: B }, new Set([ids(3)[2]!]), true).viewerCanAct,
    ).toBe(false);
  });

  it('mapStates marks bans, ordered picks and the decider', () => {
    const states = mapStates({
      pool: POOL,
      actions: [
        { sequence: 3, teamId: A, action: 'PICK', mapName: 'de_charlie', createdAt: '' },
        { sequence: 1, teamId: A, action: 'BAN', mapName: 'de_alpha', createdAt: '' },
        { sequence: 4, teamId: B, action: 'PICK', mapName: 'de_delta', createdAt: '' },
        { sequence: 7, teamId: null, action: 'DECIDER', mapName: 'de_golf', createdAt: '' },
      ],
    });
    expect(states.get('de_alpha')).toEqual({ kind: 'banned', teamId: A });
    expect(states.get('de_charlie')).toEqual({ kind: 'picked', teamId: A, order: 1 });
    expect(states.get('de_delta')).toEqual({ kind: 'picked', teamId: B, order: 2 });
    expect(states.get('de_golf')).toEqual({ kind: 'decider', order: 3 });
    expect(states.get('de_echo')).toEqual({ kind: 'available' });
  });
});

describe('bracket helpers', () => {
  it('names rounds from the end', () => {
    expect(roundLabel(4, 4)).toEqual({ key: 'final' });
    expect(roundLabel(3, 4)).toEqual({ key: 'semifinal' });
    expect(roundLabel(2, 4)).toEqual({ key: 'quarterfinal' });
    expect(roundLabel(1, 4)).toEqual({ key: 'roundOf', teams: 16 });
    expect(roundLabel(1, 6)).toEqual({ key: 'roundOf', teams: 64 });
    expect(roundLabel(1, 1)).toEqual({ key: 'final' });
  });

  it('detects byes and winners', () => {
    expect(isByeMatch({ isBye: false, status: 'CANCELLED', statusReason: 'bye' })).toBe(true);
    expect(
      isByeMatch({ isBye: false, status: 'CANCELLED', statusReason: 'tournament cancelled' }),
    ).toBe(false);
    const teamA = { id: 'a', slug: 'alpha', name: 'Alpha', tag: 'A' };
    const teamB = { id: 'b', slug: 'beta', name: 'Beta', tag: 'B' };
    expect(winnerSide({ winnerTeamSlug: 'beta', teamA, teamB })).toBe('B');
    expect(winnerSide({ winnerTeamSlug: null, teamA, teamB })).toBeNull();
    expect(winnerSide({ winnerTeamId: 'a', winnerTeamSlug: null, teamA, teamB })).toBe('A');
  });
});

describe('access helpers (UX only)', () => {
  const T = ids(3)[0]!;
  const M = ids(3)[1]!;
  const TEAM = ids(3)[2]!;
  const grant = (role: string, scopeType: string, scopeId: string | null = null) =>
    ({ role, scopeType, scopeId }) as never;

  it('operatedTeamIds: captain membership + TEAM_MANAGER grants, not plain players', () => {
    const me = {
      membership: { teamId: TEAM, teamSlug: 'x', teamName: 'X', role: 'CAPTAIN', joinedAt: '' },
      roles: [grant('TEAM_MANAGER', 'TEAM', T)],
    } as unknown as MeDtoM2;
    expect([...operatedTeamIds(me)].sort()).toEqual([T, TEAM].sort());
    const player = {
      membership: { ...me.membership!, role: 'PLAYER' },
      roles: [],
    } as unknown as MeDtoM2;
    expect(operatedTeamIds(player).size).toBe(0);
    const manager = {
      membership: me.membership,
      roles: [{ role: 'TEAM_MANAGER', scopeType: 'TEAM', scopeId: T, scopeSlug: 'nova' }],
    } as unknown as MeDtoM2;
    expect(operatedTeamSlugs(manager)).toEqual(['x', 'nova']);
    expect(operatedTeamSlugs(player)).toEqual([]);
  });

  it('tournament and match admin scopes', () => {
    expect(canCreateTournament([grant('TOURNAMENT_ADMIN', 'TOURNAMENT', T)])).toBe(false);
    expect(canCreateTournament([grant('TOURNAMENT_ADMIN', 'GLOBAL')])).toBe(true);
    expect(isTournamentAdminOf([grant('TOURNAMENT_ADMIN', 'TOURNAMENT', T)], T)).toBe(true);
    expect(isTournamentAdminOf([grant('TOURNAMENT_ADMIN', 'TOURNAMENT', M)], T)).toBe(false);
    expect(isMatchAdminOf([grant('MATCH_ADMIN', 'MATCH', M)], M, T)).toBe(true);
    expect(isMatchAdminOf([grant('MATCH_ADMIN', 'MATCH', T)], M, T)).toBe(false);
    expect(isMatchAdminOf([grant('TOURNAMENT_ADMIN', 'TOURNAMENT', T)], M, T)).toBe(true);
    expect(isMatchAdminOf([grant('OBSERVER', 'GLOBAL')], M, T)).toBe(false);
  });
});

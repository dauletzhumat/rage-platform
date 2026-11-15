import { describe, expect, it } from 'vitest';
import {
  canTransition,
  nextStatuses,
  SERIES_STATUSES,
  SERIES_TRANSITIONS,
  assertTransition,
  InvalidSeriesTransitionError,
} from '../../src/matches/state-machine.js';
import {
  assignFinalSeeds,
  bracketSize,
  nextSlotOf,
  planBracket,
  roundName,
  seedOrder,
  validateSeedAssignment,
} from '../../src/tournament-domain/bracket.js';
import { validateSeriesScore } from '../../src/tournament-domain/series-score.js';
import {
  canChangeTournamentStatus,
  isRegistrationWindowOpen,
  readSettings,
  rosterShapeProblems,
  tournamentSlugBase,
  writeSettings,
} from '../../src/tournament-domain/tournament-policy.js';
import { pickFreeSlug } from '../../src/team-domain/team-policy.js';
import { RESERVED_TOURNAMENT_SLUGS } from '../../src/tournament-domain/tournament-policy.js';
import {
  computeVeto,
  playedMapOrder,
  VETO_SEQUENCES,
  type SeriesFormat,
  type VetoRecord,
} from '../../src/tournament-domain/veto.js';

const POOL = ['de_aa', 'de_bb', 'de_cc', 'de_dd', 'de_ee', 'de_ff', 'de_gg'];

/** Simulates "better seed always wins" and returns the final pairing. */
function finalists(size: number): [number, number] {
  let line = seedOrder(size);
  while (line.length > 2) {
    const next: number[] = [];
    for (let i = 0; i < line.length; i += 2) next.push(Math.min(line[i]!, line[i + 1]!));
    line = next;
  }
  return [line[0]!, line[1]!];
}

describe('bracket seeding (TOURNAMENTS.md §6)', () => {
  it('bracket size is the next power of two ≥ N', () => {
    expect(bracketSize(2)).toBe(2);
    expect(bracketSize(3)).toBe(4);
    expect(bracketSize(5)).toBe(8);
    expect(bracketSize(8)).toBe(8);
    expect(bracketSize(9)).toBe(16);
    expect(bracketSize(33)).toBe(64);
    expect(bracketSize(64)).toBe(64);
    expect(() => bracketSize(1)).toThrow(RangeError);
    expect(() => bracketSize(2.5)).toThrow(RangeError);
  });

  it('standard order for small sizes', () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(() => seedOrder(6)).toThrow(RangeError);
  });

  for (let n = 2; n <= 64; n++) {
    it(`N=${n}: permutation, pairs sum to S+1, 1 and 2 only meet in the final, byes to top seeds`, () => {
      const plan = planBracket(n);
      const s = plan.size;
      const order = seedOrder(s);
      expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: s }, (_, i) => i + 1));
      for (let i = 0; i < s; i += 2) expect(order[i]! + order[i + 1]!).toBe(s + 1);
      expect(finalists(s).sort()).toEqual([1, 2]);
      // Seeds 1 and 2 are in opposite halves.
      const half = s / 2;
      expect(order.indexOf(1) < half).not.toBe(order.indexOf(2) < half);
      // Byes: exactly S - N, facing seeds 1..S-N; never bye vs bye.
      const byes = plan.firstRound.filter((p) => p.seedB === null);
      expect(byes.length).toBe(s - n);
      expect(byes.map((p) => p.seedA).sort((a, b) => a - b)).toEqual(
        Array.from({ length: s - n }, (_, i) => i + 1),
      );
      for (const p of plan.firstRound) {
        expect(p.seedA).toBeLessThanOrEqual(n);
        if (p.seedB !== null) expect(p.seedA).toBeLessThan(p.seedB);
      }
      // Slots: S-1 in total, each non-final links to exactly one position of the next round.
      expect(plan.slots.length).toBe(s - 1);
      const targets = new Set(
        plan.slots
          .filter((x) => x.next)
          .map((x) => `${x.next!.roundNumber}:${x.next!.slotNumber}:${x.next!.position}`),
      );
      expect(targets.size).toBe(s - 2);
      expect(plan.slots.filter((x) => x.next === null)).toHaveLength(1);
    });
  }

  it('slot linking and round names', () => {
    expect(nextSlotOf(1, 1, 3)).toEqual({ roundNumber: 2, slotNumber: 1, position: 'A' });
    expect(nextSlotOf(1, 2, 3)).toEqual({ roundNumber: 2, slotNumber: 1, position: 'B' });
    expect(nextSlotOf(1, 3, 3)).toEqual({ roundNumber: 2, slotNumber: 2, position: 'A' });
    expect(nextSlotOf(3, 1, 3)).toBeNull();
    expect(roundName(3, 3)).toBe('Final');
    expect(roundName(2, 3)).toBe('Semifinals');
    expect(roundName(1, 3)).toBe('Quarterfinals');
    expect(roundName(1, 6)).toBe('Round of 64');
    expect(roundName(1, 1)).toBe('Final');
  });

  it('byes for N=3, 5, 6', () => {
    const three = planBracket(3);
    expect(three.firstRound).toEqual([
      { slotNumber: 1, seedA: 1, seedB: null },
      { slotNumber: 2, seedA: 2, seedB: 3 },
    ]);
    const five = planBracket(5);
    expect(five.firstRound).toEqual([
      { slotNumber: 1, seedA: 1, seedB: null },
      { slotNumber: 2, seedA: 4, seedB: 5 },
      { slotNumber: 3, seedA: 2, seedB: null },
      { slotNumber: 4, seedA: 3, seedB: null },
    ]);
    const six = planBracket(6);
    expect(six.firstRound.filter((p) => p.seedB === null).map((p) => p.seedA)).toEqual([1, 2]);
  });

  it('final seeds: seeded first by seed, then unseeded by approval time, renumbered 1..N', () => {
    const t = (ms: number) => new Date(ms);
    const out = assignFinalSeeds([
      { id: 'c', seed: null, approvedAt: t(3) },
      { id: 'a', seed: 4, approvedAt: t(9) },
      { id: 'b', seed: 1, approvedAt: t(9) },
      { id: 'd', seed: null, approvedAt: t(1) },
    ]);
    expect(out.map((r) => [r.id, r.finalSeed])).toEqual([
      ['b', 1],
      ['a', 2],
      ['d', 3],
      ['c', 4],
    ]);
  });

  it('seed payload validation', () => {
    const ids = ['r1', 'r2', 'r3'];
    const ok = [
      { registrationId: 'r1', seed: 2 },
      { registrationId: 'r2', seed: 1 },
      { registrationId: 'r3', seed: 3 },
    ];
    expect(validateSeedAssignment(ids, ok)).toBeNull();
    expect(validateSeedAssignment(ids, ok.slice(0, 2))).not.toBeNull();
    expect(
      validateSeedAssignment(ids, [...ok.slice(0, 2), { registrationId: 'r3', seed: 2 }]),
    ).not.toBeNull();
    expect(
      validateSeedAssignment(ids, [...ok.slice(0, 2), { registrationId: 'x', seed: 3 }]),
    ).not.toBeNull();
    expect(
      validateSeedAssignment(ids, [...ok.slice(0, 2), { registrationId: 'r3', seed: 4 }]),
    ).not.toBeNull();
    expect(
      validateSeedAssignment(ids, [...ok.slice(0, 2), { registrationId: 'r2', seed: 3 }]),
    ).not.toBeNull();
  });
});

describe('veto sequences (TOURNAMENTS.md §8)', () => {
  function run(format: SeriesFormat): VetoRecord[] {
    const actions: VetoRecord[] = [];
    for (;;) {
      const s = computeVeto(format, POOL, actions);
      if (s.deciderPending) {
        expect(s.remaining).toHaveLength(1);
        actions.push({ sequence: actions.length + 1, action: 'DECIDER', mapName: s.remaining[0]! });
        continue;
      }
      if (s.complete) return actions;
      expect(s.next!.sequence).toBe(actions.length + 1);
      actions.push({
        sequence: s.next!.sequence,
        action: s.next!.action,
        mapName: s.remaining[0]!,
      });
    }
  }

  it('exact sequences; team A starts and turns alternate', () => {
    const fmt = (steps: readonly { side: string; action: string }[]) =>
      steps.map((x) => `${x.side}:${x.action}`).join(' ');
    expect(fmt(VETO_SEQUENCES.BO1)).toBe('A:BAN B:BAN A:BAN B:BAN A:BAN B:BAN');
    expect(fmt(VETO_SEQUENCES.BO3)).toBe('A:BAN B:BAN A:PICK B:PICK A:BAN B:BAN');
    expect(fmt(VETO_SEQUENCES.BO5)).toBe('A:BAN B:BAN A:PICK B:PICK A:PICK B:PICK');
    for (const seq of Object.values(VETO_SEQUENCES)) {
      seq.forEach((step, i) => expect(step.side).toBe(i % 2 === 0 ? 'A' : 'B'));
    }
  });

  for (const [format, maps] of [
    ['BO1', 1],
    ['BO3', 3],
    ['BO5', 5],
  ] as const) {
    it(`${format}: 6 steps + decider uses all 7 maps once, ${maps} map(s) played, decider last`, () => {
      const actions = run(format);
      expect(actions).toHaveLength(7);
      expect(new Set(actions.map((a) => a.mapName)).size).toBe(7);
      expect(actions.at(-1)!.action).toBe('DECIDER');
      const order = playedMapOrder(actions);
      expect(order).toHaveLength(maps);
      expect(order.at(-1)).toBe(actions.at(-1)!.mapName);
      const final = computeVeto(format, POOL, actions);
      expect(final).toMatchObject({ complete: true, next: null, remaining: [] });
    });
  }

  it('state is derived from unordered records', () => {
    const s = computeVeto('BO3', POOL, [
      { sequence: 2, action: 'BAN', mapName: 'de_bb' },
      { sequence: 1, action: 'BAN', mapName: 'de_aa' },
    ]);
    expect(s.next).toEqual({ side: 'A', action: 'PICK', sequence: 3 });
    expect(s.remaining).toEqual(['de_cc', 'de_dd', 'de_ee', 'de_ff', 'de_gg']);
  });
});

describe('series score validation (TOURNAMENTS.md §9)', () => {
  const valid: Array<[SeriesFormat, number, number, 'A' | 'B']> = [
    ['BO1', 1, 0, 'A'],
    ['BO1', 0, 1, 'B'],
    ['BO3', 2, 0, 'A'],
    ['BO3', 1, 2, 'B'],
    ['BO5', 3, 0, 'A'],
    ['BO5', 3, 1, 'A'],
    ['BO5', 2, 3, 'B'],
  ];
  const invalid: Array<[SeriesFormat, number, number, 'A' | 'B']> = [
    ['BO1', 1, 1, 'A'],
    ['BO1', 0, 1, 'A'],
    ['BO1', 2, 0, 'A'],
    ['BO1', 0, 0, 'A'],
    ['BO3', 2, 2, 'A'],
    ['BO3', 1, 0, 'A'],
    ['BO3', 3, 0, 'A'],
    ['BO3', 2, 1, 'B'],
    ['BO5', 2, 1, 'A'],
    ['BO5', 3, 3, 'A'],
    ['BO5', 4, 0, 'A'],
    ['BO5', -1, 3, 'B'],
    ['BO3', 1.5, 2, 'B'],
  ];
  for (const [f, a, b, w] of valid) {
    it(`${f} ${a}-${b} winner ${w} is valid`, () =>
      expect(validateSeriesScore(f, a, b, w)).toBeNull());
  }
  for (const [f, a, b, w] of invalid) {
    it(`${f} ${a}-${b} winner ${w} is invalid`, () =>
      expect(validateSeriesScore(f, a, b, w)).not.toBeNull());
  }
});

describe('series state machine (TOURNAMENTS.md §7)', () => {
  it('covers every series status; no self loops; CANCELLED is terminal', () => {
    expect(Object.keys(SERIES_TRANSITIONS).sort()).toEqual([...SERIES_STATUSES].sort());
    for (const from of SERIES_STATUSES) {
      for (const source of ['ADMIN', 'SYSTEM', 'SERVER'] as const) {
        expect(canTransition(from, from, source)).toBe(false);
      }
    }
    expect(nextStatuses('CANCELLED', 'ADMIN')).toEqual([]);
    expect(nextStatuses('CANCELLED', 'SYSTEM')).toEqual([]);
  });

  it('M3 edges: CREATED → COMPLETED only by ADMIN; CREATED → CANCELLED by ADMIN/SYSTEM', () => {
    expect(canTransition('CREATED', 'COMPLETED', 'ADMIN')).toBe(true);
    expect(canTransition('CREATED', 'COMPLETED', 'SYSTEM')).toBe(false);
    expect(canTransition('CREATED', 'COMPLETED', 'SERVER')).toBe(false);
    expect(canTransition('CREATED', 'CANCELLED', 'SYSTEM')).toBe(true);
    expect(canTransition('CREATED', 'CANCELLED', 'ADMIN')).toBe(true);
  });

  it('server lifecycle path and illegal jumps', () => {
    const path = [
      'CREATED',
      'SERVER_ASSIGNED',
      'PREPARING',
      'WARMUP',
      'READY_CHECK',
      'LIVE',
    ] as const;
    for (let i = 0; i + 1 < path.length; i++) {
      expect(nextStatuses(path[i]!, 'SYSTEM').concat(nextStatuses(path[i]!, 'SERVER'))).toContain(
        path[i + 1],
      );
    }
    expect(canTransition('LIVE', 'PAUSED', 'SERVER')).toBe(true);
    expect(canTransition('PAUSED', 'LIVE', 'ADMIN')).toBe(true);
    expect(canTransition('LIVE', 'COMPLETED', 'SERVER')).toBe(true);
    expect(canTransition('CREATED', 'LIVE', 'SERVER')).toBe(false);
    expect(canTransition('COMPLETED', 'CREATED', 'ADMIN')).toBe(false);
    expect(canTransition('COMPLETED', 'CANCELLED', 'ADMIN')).toBe(false);
    expect(canTransition('COMPLETED', 'DISPUTED', 'ADMIN')).toBe(true);
    expect(canTransition('COMPLETED', 'DISPUTED', 'SERVER')).toBe(false);
    expect(() => assertTransition('CANCELLED', 'CREATED', 'ADMIN')).toThrow(
      InvalidSeriesTransitionError,
    );
  });

  it('COMPLETED is reachable only through ADMIN or SERVER, never SYSTEM', () => {
    for (const from of SERIES_STATUSES) {
      expect(canTransition(from, 'COMPLETED', 'SYSTEM')).toBe(false);
    }
  });
});

describe('tournament policy', () => {
  it('manual lifecycle transitions', () => {
    expect(canChangeTournamentStatus('DRAFT', 'REGISTRATION_OPEN')).toBe(true);
    expect(canChangeTournamentStatus('REGISTRATION_OPEN', 'REGISTRATION_CLOSED')).toBe(true);
    expect(canChangeTournamentStatus('REGISTRATION_CLOSED', 'IN_PROGRESS')).toBe(false);
    expect(canChangeTournamentStatus('IN_PROGRESS', 'COMPLETED')).toBe(false);
    expect(canChangeTournamentStatus('DRAFT', 'REGISTRATION_CLOSED')).toBe(false);
    expect(canChangeTournamentStatus('REGISTRATION_OPEN', 'DRAFT')).toBe(false);
    for (const s of ['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS'] as const) {
      expect(canChangeTournamentStatus(s, 'CANCELLED')).toBe(true);
    }
    expect(canChangeTournamentStatus('COMPLETED', 'CANCELLED')).toBe(false);
    expect(canChangeTournamentStatus('CANCELLED', 'DRAFT')).toBe(false);
  });

  it('registration window', () => {
    const now = new Date('2026-11-14T12:00:00Z');
    const base = {
      status: 'REGISTRATION_OPEN' as const,
      registrationOpenAt: null,
      registrationCloseAt: null,
    };
    expect(isRegistrationWindowOpen(base, now)).toBe(true);
    expect(isRegistrationWindowOpen({ ...base, status: 'DRAFT' }, now)).toBe(false);
    expect(
      isRegistrationWindowOpen(
        { ...base, registrationOpenAt: new Date('2026-11-15T00:00:00Z') },
        now,
      ),
    ).toBe(false);
    expect(
      isRegistrationWindowOpen(
        { ...base, registrationCloseAt: new Date('2026-11-14T12:00:00Z') },
        now,
      ),
    ).toBe(false);
  });

  it('roster shape', () => {
    const five = ['a', 'b', 'c', 'd', 'e'];
    expect(rosterShapeProblems(five, [])).toEqual([]);
    expect(rosterShapeProblems(five, ['f', 'g'])).toEqual([]);
    expect(rosterShapeProblems(five.slice(0, 4), [])).not.toEqual([]);
    expect(rosterShapeProblems([...five.slice(0, 4), 'a'], [])).not.toEqual([]);
    expect(rosterShapeProblems(five, ['f', 'g', 'h'])).not.toEqual([]);
    expect(rosterShapeProblems(five, ['a'])).not.toEqual([]);
    expect(rosterShapeProblems(five, ['f', 'f'])).not.toEqual([]);
  });

  it('settings round-trip preserves unrelated keys and tolerates junk', () => {
    const stored = writeSettings(
      { sample: true },
      { mapPool: POOL, description: 'x', finalMatchFormat: 'BO3' },
    );
    expect(stored).toMatchObject({
      sample: true,
      mapPool: POOL,
      description: 'x',
      finalMatchFormat: 'BO3',
    });
    expect(readSettings(stored)).toEqual({
      mapPool: POOL,
      description: 'x',
      finalMatchFormat: 'BO3',
    });
    expect(readSettings({ mapPool: ['BAD', 'de_ok'], finalMatchFormat: 'BO9' })).toEqual({
      mapPool: ['de_ok'],
      description: null,
      finalMatchFormat: null,
    });
    expect(readSettings(null)).toEqual({ mapPool: [], description: null, finalMatchFormat: null });
  });

  it('slugs: derived like team slugs, reserved words suffixed, tournament- prefix', () => {
    expect(tournamentSlugBase('RAGE Autumn Cup 2026')).toBe('rage-autumn-cup-2026');
    expect(tournamentSlugBase('…', () => Buffer.alloc(6))).toBe('tournament-aaaaaa');
    expect(pickFreeSlug('register', new Set(), RESERVED_TOURNAMENT_SLUGS)).toBe('register-2');
    expect(pickFreeSlug('cup', new Set(['cup']), RESERVED_TOURNAMENT_SLUGS)).toBe('cup-2');
  });
});

describe('gate I-1: tournament datetimes need an explicit offset', () => {
  it('accepts Z / ±hh:mm, rejects local times and dates', async () => {
    const { DATETIME_WITH_OFFSET } =
      await import('../../src/tournament-admin/tournament-admin.dto.js');
    for (const ok of [
      '2026-12-01T18:00:00Z',
      '2026-12-01T18:00Z',
      '2026-12-01T18:00:00.123Z',
      '2026-12-01T18:00:00+05:00',
      '2026-12-01T18:00:00.5-03:30',
    ]) {
      expect(DATETIME_WITH_OFFSET.test(ok), ok).toBe(true);
    }
    for (const bad of [
      '2026-12-01T18:00:00',
      '2026-12-01',
      '2026-12-01T18:00:00.000',
      '2026-12-01T18:00:00+0500',
      '2026-12-01 18:00:00Z',
      '2026-12-01T18:00:00z',
    ]) {
      expect(DATETIME_WITH_OFFSET.test(bad), bad).toBe(false);
    }
  });
});

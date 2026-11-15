/**
 * Single-elimination bracket planning (docs/TOURNAMENTS.md §6). PURE and deterministic: the same
 * team count always yields the same plan.
 *
 * - Bracket size S = next power of two ≥ N (N ≥ 2).
 * - Standard seeding order: seeds are placed so that, if the better seed always wins, seed 1
 *   meets seed S in round 1, and seeds 1 and 2 can only meet in the final (1 and 2 are in
 *   opposite halves, 1–4 in different quarters, …).
 * - Seeds > N are byes; byes always face the best seeds (1, 2, …, S − N).
 * - Slot i of round r feeds slot ceil(i / 2) of round r + 1, position A for odd i, B for even i.
 */

export const MIN_BRACKET_TEAMS = 2;
export const MAX_BRACKET_TEAMS = 64;

export type SlotPosition = 'A' | 'B';

/** Smallest power of two ≥ max(n, 2). */
export function bracketSize(teamCount: number): number {
  if (!Number.isInteger(teamCount) || teamCount < MIN_BRACKET_TEAMS) {
    throw new RangeError(`a bracket needs at least ${MIN_BRACKET_TEAMS} teams`);
  }
  let size = 2;
  while (size < teamCount) size *= 2;
  return size;
}

export function roundCount(size: number): number {
  return Math.log2(size);
}

/**
 * Seed at each line of round 1, top to bottom (length = size). Built by repeatedly expanding
 * every seed s into the pair (s, current+1-s): [1,2] → [1,4,2,3] → [1,8,4,5,2,7,3,6] → …
 */
export function seedOrder(size: number): number[] {
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
    throw new RangeError('bracket size must be a power of two ≥ 2');
  }
  let order = [1, 2];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    order = order.flatMap((s) => [s, next - s]);
  }
  return order;
}

export interface FirstRoundPairing {
  slotNumber: number;
  /** Better (lower) seed: always a real team. */
  seedA: number;
  /** Null when the opponent is a bye. */
  seedB: number | null;
}

export interface SlotPlan {
  roundNumber: number;
  slotNumber: number;
  /** Where the winner goes; null for the final. */
  next: { roundNumber: number; slotNumber: number; position: SlotPosition } | null;
}

export interface BracketPlan {
  teamCount: number;
  size: number;
  rounds: number;
  /** All slots, ordered by round then slot. */
  slots: SlotPlan[];
  firstRound: FirstRoundPairing[];
}

export function nextSlotOf(
  roundNumber: number,
  slotNumber: number,
  rounds: number,
): SlotPlan['next'] {
  if (roundNumber >= rounds) return null;
  return {
    roundNumber: roundNumber + 1,
    slotNumber: Math.ceil(slotNumber / 2),
    position: slotNumber % 2 === 1 ? 'A' : 'B',
  };
}

export function planBracket(teamCount: number): BracketPlan {
  const size = bracketSize(teamCount);
  const rounds = roundCount(size);
  const slots: SlotPlan[] = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    for (let s = 1; s <= count; s++) {
      slots.push({ roundNumber: r, slotNumber: s, next: nextSlotOf(r, s, rounds) });
    }
  }
  const order = seedOrder(size);
  const firstRound: FirstRoundPairing[] = [];
  for (let i = 0; i < size / 2; i++) {
    const x = order[2 * i]!;
    const y = order[2 * i + 1]!;
    const better = Math.min(x, y);
    const worse = Math.max(x, y);
    firstRound.push({
      slotNumber: i + 1,
      seedA: better,
      seedB: worse > teamCount ? null : worse,
    });
  }
  return { teamCount, size, rounds, slots, firstRound };
}

/** Display name of a round: Final, Semifinals, Quarterfinals, Round of 16, … */
export function roundName(roundNumber: number, rounds: number): string {
  const remaining = rounds - roundNumber; // 0 = final
  if (remaining === 0) return 'Final';
  if (remaining === 1) return 'Semifinals';
  if (remaining === 2) return 'Quarterfinals';
  return `Round of ${2 ** (remaining + 1)}`;
}

/**
 * Final seed assignment (§6): registrations that already carry a seed keep their relative order
 * (by seed), unseeded ones follow ordered by approval time, then id; seeds are renumbered 1..N
 * so gaps (e.g. after a withdrawal) disappear.
 */
export function assignFinalSeeds<
  T extends { id: string; seed: number | null; approvedAt: Date | null },
>(registrations: readonly T[]): Array<T & { finalSeed: number }> {
  const sorted = [...registrations].sort((a, b) => {
    if (a.seed !== null && b.seed !== null) return a.seed - b.seed || cmp(a.id, b.id);
    if (a.seed !== null) return -1;
    if (b.seed !== null) return 1;
    const ta = a.approvedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const tb = b.approvedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ta - tb || cmp(a.id, b.id);
  });
  return sorted.map((r, i) => ({ ...r, finalSeed: i + 1 }));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Seeds payload check (§6): exactly the APPROVED ids, seeds exactly 1..N. Returns a message. */
export function validateSeedAssignment(
  approvedIds: readonly string[],
  seeds: ReadonlyArray<{ registrationId: string; seed: number }>,
): string | null {
  const n = approvedIds.length;
  if (seeds.length !== n) return `seeds must cover all ${n} approved registrations`;
  const ids = new Set(seeds.map((s) => s.registrationId));
  if (ids.size !== seeds.length) return 'each registration may appear only once';
  for (const id of approvedIds) {
    if (!ids.has(id)) return 'seeds must cover every APPROVED registration';
  }
  const values = new Set(seeds.map((s) => s.seed));
  if (values.size !== seeds.length) return 'seeds must be unique';
  for (let i = 1; i <= n; i++) {
    if (!values.has(i)) return `seeds must be exactly 1..${n}`;
  }
  return null;
}

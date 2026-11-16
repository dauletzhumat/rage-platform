/**
 * Map veto sequences (docs/TOURNAMENTS.md §8). PURE. Team A (better seed) starts; once every
 * step is taken, the single remaining map is the DECIDER (inserted by the server). Side
 * selection is out of scope until M4 (knife round / server).
 */

export type VetoSide = 'A' | 'B';
export type VetoTurnAction = 'BAN' | 'PICK';
export type VetoRecordedAction = VetoTurnAction | 'DECIDER';
export type SeriesFormat = 'BO1' | 'BO3' | 'BO5';

export interface VetoStep {
  side: VetoSide;
  action: VetoTurnAction;
}

const ban = (side: VetoSide): VetoStep => ({ side, action: 'BAN' });
const pick = (side: VetoSide): VetoStep => ({ side, action: 'PICK' });

export const VETO_SEQUENCES: Readonly<Record<SeriesFormat, readonly VetoStep[]>> = {
  BO1: [ban('A'), ban('B'), ban('A'), ban('B'), ban('A'), ban('B')],
  BO3: [ban('A'), ban('B'), pick('A'), pick('B'), ban('A'), ban('B')],
  BO5: [ban('A'), ban('B'), pick('A'), pick('B'), pick('A'), pick('B')],
};

/** Maps played per format = picks + decider. */
export const MAPS_PER_FORMAT: Readonly<Record<SeriesFormat, number>> = { BO1: 1, BO3: 3, BO5: 5 };

export interface VetoRecord {
  sequence: number;
  action: VetoRecordedAction;
  mapName: string;
}

export interface VetoComputation {
  /** Next expected step, or null when complete (or only the decider is missing). */
  next: (VetoStep & { sequence: number }) | null;
  remaining: string[];
  complete: boolean;
  /** All steps are taken but the DECIDER row is not recorded yet. */
  deciderPending: boolean;
}

/** Derives the veto state from the recorded actions (ordered or not). */
export function computeVeto(
  format: SeriesFormat,
  pool: readonly string[],
  actions: readonly VetoRecord[],
): VetoComputation {
  const sequence = VETO_SEQUENCES[format];
  const ordered = [...actions].sort((a, b) => a.sequence - b.sequence);
  const used = new Set(ordered.map((a) => a.mapName));
  const remaining = pool.filter((m) => !used.has(m));
  const hasDecider = ordered.some((a) => a.action === 'DECIDER');
  const steps = ordered.filter((a) => a.action !== 'DECIDER').length;
  if (hasDecider) return { next: null, remaining, complete: true, deciderPending: false };
  if (steps >= sequence.length) {
    return { next: null, remaining, complete: false, deciderPending: true };
  }
  const step = sequence[steps]!;
  return {
    next: { ...step, sequence: steps + 1 },
    remaining,
    complete: false,
    deciderPending: false,
  };
}

/**
 * Map order after a complete veto: picks in pick order, decider last (§8). BO1 → [decider].
 */
export function playedMapOrder(actions: readonly VetoRecord[]): string[] {
  const ordered = [...actions].sort((a, b) => a.sequence - b.sequence);
  return [
    ...ordered.filter((a) => a.action === 'PICK').map((a) => a.mapName),
    ...ordered.filter((a) => a.action === 'DECIDER').map((a) => a.mapName),
  ];
}

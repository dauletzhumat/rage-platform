/**
 * Series score validation for admin result overrides (docs/TOURNAMENTS.md §9). PURE.
 * Scores are MAPS WON in the series (not rounds): BO1 1–0; BO3 2–0 / 2–1; BO5 3–0 / 3–1 / 3–2.
 * The declared winner must hold the winning number of maps.
 */
import type { SeriesFormat } from './veto.js';

export const MAPS_TO_WIN: Readonly<Record<SeriesFormat, number>> = { BO1: 1, BO3: 2, BO5: 3 };

/** Returns null when valid, otherwise a human-readable reason. */
export function validateSeriesScore(
  format: SeriesFormat,
  teamAScore: number,
  teamBScore: number,
  winner: 'A' | 'B',
): string | null {
  if (!Number.isInteger(teamAScore) || !Number.isInteger(teamBScore)) {
    return 'scores must be integers';
  }
  if (teamAScore < 0 || teamBScore < 0) return 'scores must not be negative';
  const need = MAPS_TO_WIN[format];
  const [w, l] = winner === 'A' ? [teamAScore, teamBScore] : [teamBScore, teamAScore];
  if (w !== need) return `the winner of a ${format} must have won exactly ${need} map(s)`;
  if (l >= need) return `the loser of a ${format} can have won at most ${need - 1} map(s)`;
  return null;
}

export const MAP_ROUND_SCORE_MAX = 99;

export interface MapScoreInput {
  mapOrder: number;
  teamAScore: number;
  teamBScore: number;
}

export interface DerivedSeries {
  teamAScore: number;
  teamBScore: number;
  winner: 'A' | 'B';
  /** Per listed map: which side won it. */
  mapWinners: Array<'A' | 'B'>;
}

/**
 * Per-map round scores for an admin result (TOURNAMENTS.md §9, owner feedback). Deliberately
 * loose on CS2 plausibility (no MR12 / overtime rules): each score 0–99, the map winner has more
 * rounds (no draws). Maps are listed in play order 1..k without gaps and stop as soon as a team
 * reaches the series majority (BO1: exactly 1 map; BO3: 2–3; BO5: 3–5). Returns the derived
 * series (maps won) or a human-readable reason.
 */
export function deriveSeriesFromMaps(
  format: SeriesFormat,
  maps: readonly MapScoreInput[],
): DerivedSeries | string {
  const need = MAPS_TO_WIN[format];
  if (maps.length === 0) return 'maps must not be empty';
  let a = 0;
  let b = 0;
  const mapWinners: Array<'A' | 'B'> = [];
  for (const [i, m] of maps.entries()) {
    if (m.mapOrder !== i + 1) return 'maps must be listed in play order 1, 2, … without gaps';
    for (const score of [m.teamAScore, m.teamBScore]) {
      if (!Number.isInteger(score) || score < 0 || score > MAP_ROUND_SCORE_MAX) {
        return `map round scores must be integers 0–${MAP_ROUND_SCORE_MAX}`;
      }
    }
    if (m.teamAScore === m.teamBScore) return `map ${m.mapOrder} needs a winner (no draws)`;
    if (a === need || b === need) {
      return `the series was already decided before map ${m.mapOrder}`;
    }
    if (m.teamAScore > m.teamBScore) {
      a += 1;
      mapWinners.push('A');
    } else {
      b += 1;
      mapWinners.push('B');
    }
  }
  if (a !== need && b !== need) {
    return `no team reached ${need} map win(s) for a ${format}`;
  }
  return { teamAScore: a, teamBScore: b, winner: a === need ? 'A' : 'B', mapWinners };
}

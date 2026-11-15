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

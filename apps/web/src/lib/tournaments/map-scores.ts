import type { MapResultInputDto, MatchFormat } from '@/lib/api/types';
import { winsNeeded } from './validation';

/**
 * Per-map round scores for an admin result (docs/TOURNAMENTS.md §9, map-score extension).
 * Mirrors the API rules so the dialog can explain problems before submitting:
 * maps are filled in veto order without gaps, each map has a winner (no draws), scores are
 * integers 0–99, and entry stops as soon as one team reaches the majority (BO1: exactly 1 map,
 * BO3: first to 2, BO5: first to 3). The API derives the series from `maps`.
 */
export const MAP_SCORE_MAX = 99;

export interface MapScoreSlot {
  mapOrder: number;
  mapName: string;
}

export interface MapScoreInput {
  teamAScore: string;
  teamBScore: string;
}

export type MapRowError =
  'mapScoreRange' | 'mapDraw' | 'mapIncomplete' | 'mapGap' | 'mapAfterDecided';
export type MapSeriesError = 'mapsRequired' | 'seriesUndecided';

export interface MapScoreSummary {
  /** Map wins so far for each side. */
  winsA: number;
  winsB: number;
  /** Winner of each row (null for empty / invalid rows). */
  rowWinners: Array<'A' | 'B' | null>;
  /** Side holding the majority, if decided. */
  seriesWinner: 'A' | 'B' | null;
  /** Index of the row where the series was decided (rows after it must stay empty). */
  decidedAt: number | null;
}

export type MapScoreValidation =
  | {
      ok: true;
      maps: MapResultInputDto[];
      teamAScore: number;
      teamBScore: number;
      winner: 'A' | 'B';
      summary: MapScoreSummary;
    }
  | {
      ok: false;
      rowErrors: Array<MapRowError | null>;
      seriesError: MapSeriesError | null;
      summary: MapScoreSummary;
    };

function parseScore(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d{1,2}$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 0 && n <= MAP_SCORE_MAX ? n : undefined;
}

/** Live summary + validation for the dialog. `slots` are the match maps in veto order. */
export function validateMapScores(
  format: MatchFormat,
  slots: readonly MapScoreSlot[],
  inputs: readonly MapScoreInput[],
): MapScoreValidation {
  const need = winsNeeded(format);
  const ordered = [...slots].sort((a, b) => a.mapOrder - b.mapOrder);
  const rowErrors: Array<MapRowError | null> = ordered.map(() => null);
  const rowWinners: Array<'A' | 'B' | null> = ordered.map(() => null);
  const maps: MapResultInputDto[] = [];
  let winsA = 0;
  let winsB = 0;
  let decidedAt: number | null = null;
  let sawEmpty = false;

  ordered.forEach((slot, i) => {
    const input = inputs[i] ?? { teamAScore: '', teamBScore: '' };
    const a = parseScore(input.teamAScore);
    const b = parseScore(input.teamBScore);
    if (a === null && b === null) {
      sawEmpty = true;
      return;
    }
    if (decidedAt !== null) {
      rowErrors[i] = 'mapAfterDecided';
      return;
    }
    if (sawEmpty) {
      rowErrors[i] = 'mapGap';
      return;
    }
    if (a === undefined || b === undefined) {
      rowErrors[i] = 'mapScoreRange';
      return;
    }
    if (a === null || b === null) {
      rowErrors[i] = 'mapIncomplete';
      return;
    }
    if (a === b) {
      rowErrors[i] = 'mapDraw';
      return;
    }
    const w = a > b ? 'A' : 'B';
    rowWinners[i] = w;
    if (w === 'A') winsA += 1;
    else winsB += 1;
    maps.push({ mapOrder: slot.mapOrder, teamAScore: a, teamBScore: b });
    if (winsA >= need || winsB >= need) decidedAt = i;
  });

  const seriesWinner = winsA >= need ? 'A' : winsB >= need ? 'B' : null;
  const summary: MapScoreSummary = { winsA, winsB, rowWinners, seriesWinner, decidedAt };
  const hasRowErrors = rowErrors.some((e) => e !== null);
  if (hasRowErrors || seriesWinner === null) {
    return {
      ok: false,
      rowErrors,
      seriesError: hasRowErrors ? null : maps.length === 0 ? 'mapsRequired' : 'seriesUndecided',
      summary,
    };
  }
  return { ok: true, maps, teamAScore: winsA, teamBScore: winsB, winner: seriesWinner, summary };
}

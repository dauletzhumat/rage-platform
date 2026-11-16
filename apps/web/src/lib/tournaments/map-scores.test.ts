import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import kk from '../../../messages/kk.json';
import ru from '../../../messages/ru.json';
import { REASON_PRESET_KEYS } from '@/components/tournaments/reason-presets';
import { validateMapScores, type MapScoreInput } from './map-scores';

const slots = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ mapOrder: i + 1, mapName: `de_m${i + 1}` }));
const rows = (...pairs: Array<[string, string]>): MapScoreInput[] =>
  pairs.map(([teamAScore, teamBScore]) => ({ teamAScore, teamBScore }));

describe('validateMapScores', () => {
  it('BO1: exactly one decided map', () => {
    expect(validateMapScores('BO1', slots(1), rows(['13', '7']))).toMatchObject({
      ok: true,
      winner: 'A',
      teamAScore: 1,
      teamBScore: 0,
      maps: [{ mapOrder: 1, teamAScore: 13, teamBScore: 7 }],
    });
    expect(validateMapScores('BO1', slots(1), rows(['', '']))).toMatchObject({
      ok: false,
      seriesError: 'mapsRequired',
    });
  });

  it('BO3: stops at 2 wins; a third map after 2–0 must stay empty', () => {
    expect(
      validateMapScores('BO3', slots(3), rows(['13', '5'], ['16', '14'], ['', ''])),
    ).toMatchObject({ ok: true, teamAScore: 2, teamBScore: 0, winner: 'A' });
    expect(
      validateMapScores('BO3', slots(3), rows(['5', '13'], ['13', '11'], ['9', '13'])),
    ).toMatchObject({ ok: true, teamAScore: 1, teamBScore: 2, winner: 'B' });
    expect(
      validateMapScores('BO3', slots(3), rows(['13', '5'], ['13', '5'], ['13', '5'])),
    ).toMatchObject({ ok: false, rowErrors: [null, null, 'mapAfterDecided'] });
  });

  it('BO5: first to 3, map orders from the veto', () => {
    const r = validateMapScores(
      'BO5',
      slots(5),
      rows(['13', '1'], ['1', '13'], ['13', '2'], ['2', '13'], ['19', '17']),
    );
    expect(r).toMatchObject({ ok: true, teamAScore: 3, teamBScore: 2 });
    if (r.ok) expect(r.maps.map((m) => m.mapOrder)).toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects draws, gaps, incomplete rows, out-of-range and undecided series', () => {
    expect(validateMapScores('BO3', slots(3), rows(['12', '12']))).toMatchObject({
      ok: false,
      rowErrors: ['mapDraw', null, null],
    });
    expect(
      validateMapScores('BO3', slots(3), rows(['13', '1'], ['', ''], ['13', '2'])),
    ).toMatchObject({ ok: false, rowErrors: [null, null, 'mapGap'] });
    expect(validateMapScores('BO3', slots(3), rows(['13', '']))).toMatchObject({
      ok: false,
      rowErrors: ['mapIncomplete', null, null],
    });
    for (const bad of ['100', '-1', '1.5', 'x']) {
      expect(validateMapScores('BO1', slots(1), rows([bad, '0']))).toMatchObject({
        ok: false,
        rowErrors: ['mapScoreRange'],
      });
    }
    expect(validateMapScores('BO3', slots(3), rows(['13', '1'], ['2', '13']))).toMatchObject({
      ok: false,
      seriesError: 'seriesUndecided',
      summary: { winsA: 1, winsB: 1, seriesWinner: null },
    });
    expect(validateMapScores('BO1', slots(1), rows(['99', '0'])).ok).toBe(true);
  });
});

describe('reason preset catalogs', () => {
  it.each([
    ['en', en],
    ['ru', ru],
    ['kk', kk],
  ])('%s has every preset key', (_l, messages) => {
    const catalog = (messages as unknown as { reasonPresets: Record<string, unknown> })
      .reasonPresets;
    for (const keys of Object.values(REASON_PRESET_KEYS)) {
      for (const key of keys) {
        const value = key
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
        expect(typeof value, key).toBe('string');
      }
    }
  });
});

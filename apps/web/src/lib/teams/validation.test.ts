import { describe, expect, it } from 'vitest';
import {
  applicationFieldOf,
  isValidOptionalNote,
  validateInvitation,
  validateTeamApplication,
} from './validation';

const valid = { name: 'Nova Esports', tag: 'NOVA', countryCode: '', description: '' };

describe('validateTeamApplication (TEAMS.md §2)', () => {
  it('normalises and omits empty optional fields', () => {
    expect(validateTeamApplication({ ...valid, name: '  Nova Esports  ' })).toEqual({
      ok: true,
      value: { name: 'Nova Esports', tag: 'NOVA' },
    });
    expect(
      validateTeamApplication({ ...valid, countryCode: 'kz', description: '  Line 1\nLine 2 ' }),
    ).toEqual({
      ok: true,
      value: {
        name: 'Nova Esports',
        tag: 'NOVA',
        countryCode: 'KZ',
        description: 'Line 1\nLine 2',
      },
    });
  });

  it('accepts Unicode letters (Cyrillic/Kazakh) and NFC-normalises', () => {
    expect(validateTeamApplication({ ...valid, name: 'Қыран_Team' }).ok).toBe(true);
    const decomposed = 'Café Club';
    const result = validateTeamApplication({ ...valid, name: decomposed });
    expect(result).toMatchObject({ ok: true, value: { name: 'Café Club' } });
  });

  it.each([
    ['ab', 'nameLength'],
    ['a'.repeat(33), 'nameLength'],
    ['-Nova', 'nameChars'],
    ['Nova!', 'nameChars'],
    ['Nova‮X', 'nameChars'],
    ['No\u0007va', 'nameChars'],
  ])('name %j → %s', (name, code) => {
    expect(validateTeamApplication({ ...valid, name })).toEqual({
      ok: false,
      errors: { name: code },
    });
  });

  it.each(['N', 'TOOLONG', 'NO-VA', 'НОВА', ''])('tag %j is rejected', (tag) => {
    expect(validateTeamApplication({ ...valid, tag })).toMatchObject({
      ok: false,
      errors: { tag: 'tagFormat' },
    });
  });

  it('rejects bad country codes and long or bidi-laden descriptions', () => {
    expect(validateTeamApplication({ ...valid, countryCode: 'KAZ' })).toMatchObject({
      errors: { countryCode: 'countryFormat' },
    });
    expect(validateTeamApplication({ ...valid, description: 'x'.repeat(501) })).toMatchObject({
      errors: { description: 'descriptionLength' },
    });
    expect(validateTeamApplication({ ...valid, description: 'ok⁦hidden' })).toMatchObject({
      errors: { description: 'descriptionChars' },
    });
    // 500 astral code points are allowed (code points, not UTF-16 units).
    expect(validateTeamApplication({ ...valid, description: '😀'.repeat(500) }).ok).toBe(true);
  });

  it('maps API detail fields to form fields', () => {
    expect(applicationFieldOf('tag')).toBe('tag');
    expect(applicationFieldOf('description.length')).toBe('description');
    expect(applicationFieldOf('(root)')).toBeNull();
  });
});

describe('validateInvitation', () => {
  it('accepts a 17-digit individual SteamID64 (trimmed)', () => {
    expect(validateInvitation(' 76561198000000001 ', 'SUBSTITUTE')).toEqual({
      ok: true,
      value: { steamId64: '76561198000000001', role: 'SUBSTITUTE' },
    });
  });

  it.each(['7656119800000000', '765611980000000011', 'abc', '', '00000000000000001'])(
    '%j is rejected',
    (id) => {
      expect(validateInvitation(id, 'PLAYER')).toEqual({ ok: false, error: 'steamIdFormat' });
    },
  );
});

describe('isValidOptionalNote', () => {
  it('allows empty and ≤500, rejects longer or control characters', () => {
    expect(isValidOptionalNote('')).toBe(true);
    expect(isValidOptionalNote('x'.repeat(500))).toBe(true);
    expect(isValidOptionalNote('x'.repeat(501))).toBe(false);
    expect(isValidOptionalNote('a\u0000b')).toBe(false);
  });
});

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateMyProfileDto } from '../../src/me/me.dto.js';

function check(input: Record<string, unknown>) {
  const dto = plainToInstance(UpdateMyProfileDto, input);
  return { dto, errors: validateSync(dto).map((e) => e.property) };
}

/** Security gate M1, L-5: profile text normalization and control characters. */
describe('UpdateMyProfileDto', () => {
  it('normalizes nickname to NFC', () => {
    // "e" + combining acute accent → precomposed "é"
    const { dto, errors } = check({ nickname: '  René_x ' });
    expect(errors).toEqual([]);
    expect(dto.nickname).toBe('René_x');
  });

  it('accepts multi-line biographies with tabs', () => {
    expect(check({ biography: 'Line one\nLine\ttwo\r\nПривет' }).errors).toEqual([]);
    expect(check({ biography: null }).errors).toEqual([]);
  });

  it.each([
    ['NUL', 'a\u0000b'],
    ['escape', 'a\u001b[31mred'],
    ['C1 control', 'a\u0085b'],
    ['RLO override', 'admin‮gnp.exe'],
    ['isolate', 'x⁦y⁩'],
  ])('rejects %s in biography', (_name, biography) => {
    expect(check({ biography }).errors).toContain('biography');
  });
});

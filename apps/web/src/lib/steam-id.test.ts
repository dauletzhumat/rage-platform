import { describe, expect, it } from 'vitest';
import { isIndividualSteamId64 } from './steam-id';

describe('isIndividualSteamId64 (same rule as @rage/db)', () => {
  it.each(['76561197960265728', '76561198000000001', '76561202255233023'])('accepts %s', (id) => {
    expect(isIndividualSteamId64(id)).toBe(true);
  });

  it.each([
    '76561190000000008', // reserved sample range (never a real account)
    '76561197960265727', // just below the individual base
    '76561202255233024', // just above the 32-bit account range
    '7656119800000000', // 16 digits
    '7656119800000000x',
    '',
  ])('rejects %j', (id) => {
    expect(isIndividualSteamId64(id)).toBe(false);
  });
});

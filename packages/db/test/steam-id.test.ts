import { describe, expect, it } from 'vitest';
import {
  SAMPLE_STEAM_ID64_COUNT,
  SAMPLE_STEAM_ID64_MAX,
  SAMPLE_STEAM_ID64_MIN,
  STEAM_ID64_INDIVIDUAL_BASE,
  STEAM_ID64_INDIVIDUAL_MAX,
  isIndividualSteamId64,
  isSampleSteamId64,
  isSteamId64Format,
  sampleSteamId64,
} from '../src/steam-id.js';

describe('SteamID64 helpers', () => {
  it('validates the 17-digit format', () => {
    expect(isSteamId64Format('76561197960287930')).toBe(true);
    expect(isSteamId64Format('7656119796028793')).toBe(false); // 16 digits
    expect(isSteamId64Format('765611979602879300')).toBe(false); // 18 digits
    expect(isSteamId64Format('7656119796028793x')).toBe(false);
    expect(isSteamId64Format(' 76561197960287930')).toBe(false);
    expect(isSteamId64Format(Number('76561197960287930'))).toBe(false); // numbers lose precision; strings only
    expect(isSteamId64Format(undefined)).toBe(false);
  });

  it('individual range constants are consistent (base + 2^32 - 1)', () => {
    expect(BigInt(STEAM_ID64_INDIVIDUAL_MAX) - BigInt(STEAM_ID64_INDIVIDUAL_BASE)).toBe(
      2n ** 32n - 1n,
    );
  });

  it('sample range lies entirely below the individual-account base (never a real account)', () => {
    expect(BigInt(SAMPLE_STEAM_ID64_MAX)).toBeLessThan(BigInt(STEAM_ID64_INDIVIDUAL_BASE));
    expect(BigInt(SAMPLE_STEAM_ID64_MAX) - BigInt(SAMPLE_STEAM_ID64_MIN) + 1n).toBe(
      BigInt(SAMPLE_STEAM_ID64_COUNT),
    );
    expect(isIndividualSteamId64(SAMPLE_STEAM_ID64_MIN)).toBe(false);
    expect(isIndividualSteamId64(SAMPLE_STEAM_ID64_MAX)).toBe(false);
  });

  it('detects sample IDs at and around the bounds', () => {
    expect(isSampleSteamId64(SAMPLE_STEAM_ID64_MIN)).toBe(true);
    expect(isSampleSteamId64(SAMPLE_STEAM_ID64_MAX)).toBe(true);
    expect(isSampleSteamId64('76561190000000000')).toBe(false);
    expect(isSampleSteamId64('76561190000001000')).toBe(false);
    expect(isSampleSteamId64('76561197960287930')).toBe(false);
    expect(isSampleSteamId64('not-an-id')).toBe(false);
  });

  it('classifies individual account IDs', () => {
    expect(isIndividualSteamId64(STEAM_ID64_INDIVIDUAL_BASE)).toBe(true);
    expect(isIndividualSteamId64(STEAM_ID64_INDIVIDUAL_MAX)).toBe(true);
    expect(isIndividualSteamId64('76561197960265727')).toBe(false);
    expect(isIndividualSteamId64('76561202255233024')).toBe(false);
  });

  it('generates sample IDs by 1-based index and rejects out-of-range indexes', () => {
    expect(sampleSteamId64(1)).toBe(SAMPLE_STEAM_ID64_MIN);
    expect(sampleSteamId64(SAMPLE_STEAM_ID64_COUNT)).toBe(SAMPLE_STEAM_ID64_MAX);
    expect(sampleSteamId64(12)).toBe('76561190000000012');
    expect(() => sampleSteamId64(0)).toThrow(RangeError);
    expect(() => sampleSteamId64(1000)).toThrow(RangeError);
    expect(() => sampleSteamId64(1.5)).toThrow(RangeError);
    for (let i = 1; i <= SAMPLE_STEAM_ID64_COUNT; i += 97) {
      expect(isSampleSteamId64(sampleSteamId64(i))).toBe(true);
    }
  });
});

/**
 * SteamID64 helpers shared by seeds, the API and tests.
 *
 * A SteamID64 for an individual public-universe account is
 *   76561197960265728 (0x0110000100000000) + accountId, with accountId in [0, 2^32 - 1].
 *
 * Sample/demo users use 76561190000000001..76561190000000999. These are BELOW the
 * individual-account base, so the implied accountId is negative: no real Steam account can
 * ever have one of these IDs. M1 Steam authentication must reject them (see
 * `isIndividualSteamId64`, which returns false for every sample ID).
 *
 * Values are kept as decimal strings everywhere (they exceed Number.MAX_SAFE_INTEGER).
 */

export const STEAM_ID64_PATTERN = /^[0-9]{17}$/;

/** Base SteamID64 of individual accounts in the public universe (accountId = 0). */
export const STEAM_ID64_INDIVIDUAL_BASE = '76561197960265728';
/** Largest individual SteamID64 (accountId = 2^32 - 1). */
export const STEAM_ID64_INDIVIDUAL_MAX = '76561202255233023';

export const SAMPLE_STEAM_ID64_MIN = '76561190000000001';
export const SAMPLE_STEAM_ID64_MAX = '76561190000000999';
/** Number of distinct sample SteamID64 values available. */
export const SAMPLE_STEAM_ID64_COUNT = 999;

const INDIVIDUAL_BASE = BigInt(STEAM_ID64_INDIVIDUAL_BASE);
const INDIVIDUAL_MAX = BigInt(STEAM_ID64_INDIVIDUAL_MAX);
const SAMPLE_MIN = BigInt(SAMPLE_STEAM_ID64_MIN);
const SAMPLE_MAX = BigInt(SAMPLE_STEAM_ID64_MAX);

/** True when `value` is a string of exactly 17 decimal digits (same rule as the DB CHECK). */
export function isSteamId64Format(value: unknown): value is string {
  return typeof value === 'string' && STEAM_ID64_PATTERN.test(value);
}

/** True when `value` lies in the reserved sample/demo range (never a real Steam account). */
export function isSampleSteamId64(value: unknown): boolean {
  if (!isSteamId64Format(value)) return false;
  const n = BigInt(value);
  return n >= SAMPLE_MIN && n <= SAMPLE_MAX;
}

/**
 * True when `value` is well-formed and within the individual public-account range.
 * This is a structural check only — it does NOT prove the account exists or was verified.
 */
export function isIndividualSteamId64(value: unknown): boolean {
  if (!isSteamId64Format(value)) return false;
  const n = BigInt(value);
  return n >= INDIVIDUAL_BASE && n <= INDIVIDUAL_MAX;
}

/** Returns the n-th sample SteamID64 (1-based, 1..999). */
export function sampleSteamId64(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > SAMPLE_STEAM_ID64_COUNT) {
    throw new RangeError(
      `sample SteamID64 index must be an integer in 1..${SAMPLE_STEAM_ID64_COUNT}, got ${n}`,
    );
  }
  return (SAMPLE_MIN + BigInt(n - 1)).toString();
}

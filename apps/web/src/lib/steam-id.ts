/**
 * Individual Steam accounts: SteamID64 = 76561197960265728 + accountId (32-bit).
 * Mirrors `isIndividualSteamId64` in @rage/db (web must not depend on the db package).
 */
const INDIVIDUAL_BASE = 76561197960265728n;
const INDIVIDUAL_MAX = INDIVIDUAL_BASE + 0xffffffffn;

export function isIndividualSteamId64(value: string): boolean {
  if (!/^\d{17}$/.test(value)) return false;
  const id = BigInt(value);
  return id >= INDIVIDUAL_BASE && id <= INDIVIDUAL_MAX;
}

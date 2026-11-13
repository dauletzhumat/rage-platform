import { randomBytes } from 'node:crypto';

/** Nickname rule (AUTH.md §9): 2–32 chars of letters, digits, `_ . -` and inner spaces. */
export const NICKNAME_PATTERN = /^[\p{L}\p{N}_.\- ]+$/u;
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 32;

/**
 * Visible-text rule (M2 security gate L-2) for nicknames and team names: no default-ignorable /
 * invisible code points — explicitly incl. the Hangul fillers U+115F, U+1160, U+3164, U+FFA0,
 * which are `\p{L}` and would otherwise pass a letter pattern — and at least one letter or
 * digit. Mixed-script confusables are out of scope (tracked separately).
 */
export const VISIBLE_TEXT_PATTERN =
  /^(?![\s\S]*[\p{Default_Ignorable_Code_Point}ᅟᅠㅤﾠ])(?=[\s\S]*[\p{L}\p{N}])[\s\S]*$/u;

export function isVisibleText(value: string): boolean {
  return VISIBLE_TEXT_PATTERN.test(value);
}

export function isValidNickname(value: string): boolean {
  return (
    value.length >= NICKNAME_MIN &&
    value.length <= NICKNAME_MAX &&
    value === value.trim() &&
    NICKNAME_PATTERN.test(value) &&
    isVisibleText(value)
  );
}

export function defaultNickname(steamId64: string): string {
  return `player-${steamId64.slice(-6)}`;
}

/** Steam display names are untrusted text: use only if they satisfy the nickname rule. */
export function nicknameFromDisplayName(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const candidate = displayName.normalize('NFC').trim();
  return isValidNickname(candidate) ? candidate : null;
}

const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PLAYER_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isUuidShaped(value: string): boolean {
  return UUID_SHAPED.test(value);
}

/**
 * Slug candidates for a new player, in preference order. All start with `player-`, so they
 * can never be UUID-shaped (ADR-018 Q3); the final ones add randomness for collisions.
 */
export function playerSlugCandidates(
  steamId64: string,
  random: (n: number) => Buffer = (n) => randomBytes(n),
): string[] {
  const base = `player-${steamId64.slice(-6)}`;
  const out = [base, `player-${steamId64.slice(-10)}`, `player-${steamId64}`];
  for (let i = 0; i < 3; i++) {
    out.push(`${base}-${random(4).toString('hex')}`);
  }
  return out.filter((s) => PLAYER_SLUG_PATTERN.test(s) && !isUuidShaped(s));
}

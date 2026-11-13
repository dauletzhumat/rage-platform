import { randomBytes } from 'node:crypto';
import { isUuidShaped } from '../auth/profile-rules.js';

/** Policy constants (docs/TEAMS.md §2, ADR-019). */
export const ROSTER_CAP = 7;
export const INVITATION_TTL_MS = 7 * 24 * 3600_000;
export const MAX_PENDING_INVITATIONS_PER_TEAM = 10;
export const MY_APPLICATIONS_LIMIT = 20;
/** Gate L-3: application submissions per applicant per rolling 24 h. */
export const APPLICATION_QUOTA_PER_DAY = 5;
export const APPLICATION_QUOTA_WINDOW_MS = 24 * 3600_000;
/** Gate L-5: re-invite cooldown after a REVOKED / DECLINED invitation (same team + invitee). */
export const INVITATION_COOLDOWN_MS = 24 * 3600_000;
export const MY_INVITATIONS_LIMIT = 50;

export const TEAM_NAME_MIN = 3;
export const TEAM_NAME_MAX = 32;
/** Must start with a letter/digit; then letters, digits, space, `.`, `_`, `-`. */
export const TEAM_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;
export const TEAM_TAG_MIN = 2;
export const TEAM_TAG_MAX = 6;
export const TEAM_TAG_PATTERN = /^[A-Za-z0-9]+$/;
export const TEAM_DESCRIPTION_MAX = 500;
export const REASON_MIN = 3;
export const REASON_MAX = 500;
export const SLUG_BASE_MAX = 48;

/** Membership roles used in M2; MANAGER/COACH enum values are never written (ADR-019). */
export const M2_MEMBERSHIP_ROLES = ['CAPTAIN', 'PLAYER', 'SUBSTITUTE'] as const;
export type M2MembershipRole = (typeof M2_MEMBERSHIP_ROLES)[number];
export const INVITATION_ROLES = ['PLAYER', 'SUBSTITUTE'] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

/**
 * Enumerated `team_memberships.left_reason` values. Free-text reasons (remove/revoke) live only
 * in the audit log and are never shown publicly (TEAMS.md §4.2). `role_change` and `admin` are
 * reserved by the contract; M2 writes `left`, `removed` and `captain_transfer`.
 */
export const LEFT_REASONS = [
  'left',
  'removed',
  'role_change',
  'captain_transfer',
  'admin',
] as const;
export type LeftReason = (typeof LEFT_REASONS)[number];
const LEFT_REASON_SET: ReadonlySet<string> = new Set(LEFT_REASONS);
export function publicLeftReason(value: string | null): LeftReason | null {
  return value !== null && LEFT_REASON_SET.has(value) ? (value as LeftReason) : null;
}

/**
 * First-segment slugs the web app uses under `/teams/…` (e.g. `/teams/apply`); a team with such
 * a slug would be unreachable, so these are treated as taken.
 */
export const RESERVED_TEAM_SLUGS: ReadonlySet<string> = new Set([
  'apply',
  'new',
  'create',
  'edit',
  'manage',
  'admin',
  'settings',
  'search',
  'me',
  'api',
]);

const SLUG_RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function randomSlugSuffix(length = 6, random: (n: number) => Buffer = randomBytes): string {
  const bytes = random(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += SLUG_RANDOM_ALPHABET[bytes[i]! % SLUG_RANDOM_ALPHABET.length];
  }
  return out;
}

/**
 * Server-side slug base from a team name (TEAMS.md §2): NFKD → strip diacritics → lowercase →
 * runs of non `[a-z0-9]` → `-` → trim `-` → max 48. Empty → `team-<random6>`. A UUID-shaped
 * result is prefixed with `team-` so slugs can never be confused with ids.
 */
export function slugBaseFromName(name: string, random?: (n: number) => Buffer): string {
  let slug = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  slug = slug.slice(0, SLUG_BASE_MAX).replace(/-+$/g, '');
  if (!slug) return `team-${randomSlugSuffix(6, random)}`;
  if (isUuidShaped(slug)) slug = `team-${slug}`.slice(0, SLUG_BASE_MAX).replace(/-+$/g, '');
  return slug;
}

/** First free slug: `base`, `base-2`, `base-3`, … given the set of taken slugs. */
export function pickFreeSlug(base: string, taken: ReadonlySet<string>): string {
  const isFree = (s: string) => !taken.has(s) && !RESERVED_TEAM_SLUGS.has(s);
  if (isFree(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base}-${n}`;
    if (isFree(candidate)) return candidate;
  }
  return `${base}-${randomSlugSuffix(8)}`;
}

/** Name normalisation used by DTO transforms: NFC + trim. */
export function normalizeText(value: unknown): unknown {
  return typeof value === 'string' ? value.normalize('NFC').trim() : value;
}

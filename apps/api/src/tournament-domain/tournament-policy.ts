/**
 * Tournament policy constants and pure helpers (docs/TOURNAMENTS.md §3–§4, ADR-020).
 */
import type { MatchFormat, Prisma, TournamentStatus } from '@rage/db';
import { slugBaseFromName } from '../team-domain/team-policy.js';

export const TOURNAMENT_NAME_MIN = 3;
export const TOURNAMENT_NAME_MAX = 64;
export const TOURNAMENT_DESCRIPTION_MAX = 2000;
export const MAX_TEAMS_MIN = 2;
export const MAX_TEAMS_MAX = 64;
/** Exactly this many maps, admin-supplied (no built-in pool; the CS2 active pool changes). */
export const MAP_POOL_SIZE = 7;
export const MAP_NAME_PATTERN = /^de_[a-z0-9_]{2,30}$/;
export const ROSTER_STARTERS = 5;
export const ROSTER_MAX_SUBSTITUTES = 2;
export const MY_REGISTRATIONS_LIMIT = 50;

/** Bracket formats accepted by the API in M3 (others → 409 FORMAT_NOT_SUPPORTED). */
export const SUPPORTED_BRACKET_FORMATS = ['SINGLE_ELIMINATION'] as const;

/**
 * Web routes under `/tournaments/…` plus the generic reserved words of team slugs; a tournament
 * with such a slug would shadow a page, so these are treated as taken.
 */
export const RESERVED_TOURNAMENT_SLUGS: ReadonlySet<string> = new Set([
  'new',
  'create',
  'edit',
  'manage',
  'admin',
  'settings',
  'search',
  'me',
  'api',
  'apply',
  'register',
  'registrations',
  'bracket',
  'teams',
]);

/** Tournament slug base: same derivation as team slugs; empty → `tournament-<random6>`. */
export function tournamentSlugBase(name: string, random?: (n: number) => Buffer): string {
  return slugBaseFromName(name, random, 'tournament');
}

// ---------------------------------------------------------------------------------------------
// Lifecycle (§3)
// ---------------------------------------------------------------------------------------------

/**
 * Transitions allowed through `POST /admin/tournaments/:id/status`. REGISTRATION_CLOSED →
 * IN_PROGRESS happens only via generate-bracket, IN_PROGRESS → COMPLETED only when the final
 * completes; CANCELLED from any state before COMPLETED.
 */
export const MANUAL_TOURNAMENT_TRANSITIONS: Readonly<
  Record<TournamentStatus, readonly TournamentStatus[]>
> = {
  DRAFT: ['REGISTRATION_OPEN', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['CANCELLED'],
  IN_PROGRESS: ['CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canChangeTournamentStatus(from: TournamentStatus, to: TournamentStatus): boolean {
  return MANUAL_TOURNAMENT_TRANSITIONS[from].includes(to);
}

/** Settings (name, formats, window, pool, …) are editable only before registration closes. */
export const EDITABLE_TOURNAMENT_STATUSES: ReadonlySet<TournamentStatus> = new Set([
  'DRAFT',
  'REGISTRATION_OPEN',
]);

/** Registration accepted iff REGISTRATION_OPEN and `now` is inside the optional window. */
export function isRegistrationWindowOpen(
  t: {
    status: TournamentStatus;
    registrationOpenAt: Date | null;
    registrationCloseAt: Date | null;
  },
  now: Date,
): boolean {
  if (t.status !== 'REGISTRATION_OPEN') return false;
  if (t.registrationOpenAt && now.getTime() < t.registrationOpenAt.getTime()) return false;
  if (t.registrationCloseAt && now.getTime() >= t.registrationCloseAt.getTime()) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// settings_json
// ---------------------------------------------------------------------------------------------

export interface TournamentSettings {
  description: string | null;
  mapPool: string[];
  finalMatchFormat: MatchFormat | null;
}

const MATCH_FORMAT_SET: ReadonlySet<string> = new Set(['BO1', 'BO3', 'BO5']);

/** Tolerant reader: unknown / malformed values become defaults (sample rows predate M3). */
export function readSettings(json: unknown): TournamentSettings {
  const o = json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  const raw = o as Record<string, unknown>;
  const description = typeof raw.description === 'string' ? raw.description : null;
  const mapPool = Array.isArray(raw.mapPool)
    ? raw.mapPool.filter((m): m is string => typeof m === 'string' && MAP_NAME_PATTERN.test(m))
    : [];
  const finalMatchFormat =
    typeof raw.finalMatchFormat === 'string' && MATCH_FORMAT_SET.has(raw.finalMatchFormat)
      ? (raw.finalMatchFormat as MatchFormat)
      : null;
  return { description, mapPool, finalMatchFormat };
}

/** Merges M3 settings into the stored object, preserving unrelated keys. */
export function writeSettings(
  existing: unknown,
  patch: Partial<TournamentSettings>,
): Prisma.InputJsonObject {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  if (patch.description !== undefined) base.description = patch.description;
  if (patch.mapPool !== undefined) base.mapPool = [...patch.mapPool];
  if (patch.finalMatchFormat !== undefined) base.finalMatchFormat = patch.finalMatchFormat;
  return base as Prisma.InputJsonObject;
}

/** Match format for a bracket match: the final may use `finalMatchFormat`. */
export function matchFormatFor(
  isFinal: boolean,
  defaultFormat: MatchFormat,
  settings: TournamentSettings,
): MatchFormat {
  return isFinal && settings.finalMatchFormat ? settings.finalMatchFormat : defaultFormat;
}

// ---------------------------------------------------------------------------------------------
// Roster shape (§4)
// ---------------------------------------------------------------------------------------------

/** Exactly 5 distinct starters, ≤ 2 distinct substitutes, no overlap. Returns problems. */
export function rosterShapeProblems(
  starters: readonly string[],
  substitutes: readonly string[],
): Array<{ field: string; message: string }> {
  const problems: Array<{ field: string; message: string }> = [];
  if (starters.length !== ROSTER_STARTERS) {
    problems.push({ field: 'starters', message: `exactly ${ROSTER_STARTERS} starters required` });
  }
  if (new Set(starters).size !== starters.length) {
    problems.push({ field: 'starters', message: 'starters must be distinct' });
  }
  if (substitutes.length > ROSTER_MAX_SUBSTITUTES) {
    problems.push({
      field: 'substitutes',
      message: `at most ${ROSTER_MAX_SUBSTITUTES} substitutes allowed`,
    });
  }
  if (new Set(substitutes).size !== substitutes.length) {
    problems.push({ field: 'substitutes', message: 'substitutes must be distinct' });
  }
  const starterSet = new Set(starters);
  if (substitutes.some((s) => starterSet.has(s))) {
    problems.push({ field: 'substitutes', message: 'a player cannot be starter and substitute' });
  }
  return problems;
}

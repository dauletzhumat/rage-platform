import type {
  ApiFailure,
  CreateRegistrationDto,
  CreateTournamentDto,
  MatchFormat,
  PlayerIneligibleReason,
  ResultOverrideDto,
  TournamentStatus,
} from '@/lib/api/types';
import { PLAYER_INELIGIBLE_REASONS } from '@/lib/api/types';
import {
  FORBIDDEN_NAME_CHARS,
  FORBIDDEN_TEXT_CHARS,
  NAME_PATTERN,
  textLength,
} from '@/lib/teams/validation';

/**
 * Client-side mirror of the M3 rules (docs/TOURNAMENTS.md §3.1, §4, §6, §9).
 * Fast feedback only — the API re-validates everything inside its transactions.
 */
export const MAP_POOL_SIZE = 7;
export const MAP_NAME_PATTERN = /^de_[a-z0-9_]{2,30}$/;
export const TOURNAMENT_NAME_MIN = 3;
export const TOURNAMENT_NAME_MAX = 64;
export const TOURNAMENT_DESCRIPTION_MAX = 2000;
export const MAX_TEAMS_MIN = 2;
export const MAX_TEAMS_MAX = 64;
export const STARTERS_REQUIRED = 5;
export const SUBSTITUTES_MAX = 2;

// ---------- map pool ----------

export type MapPoolErrorCode = 'mapRequired' | 'mapFormat' | 'mapDuplicate';

export type MapPoolValidation =
  { ok: true; value: string[] } | { ok: false; errors: Array<MapPoolErrorCode | null> };

/**
 * Exactly 7 distinct names matching `^de_[a-z0-9_]{2,30}$` (trimmed, lower-cased). Errors are
 * reported per input index; a duplicate is flagged on its second occurrence. The platform ships
 * no default pool — the admin supplies every name.
 */
export function validateMapPool(values: readonly string[]): MapPoolValidation {
  const normalized = Array.from({ length: MAP_POOL_SIZE }, (_, i) =>
    (values[i] ?? '').trim().toLowerCase(),
  );
  const errors: Array<MapPoolErrorCode | null> = normalized.map(() => null);
  const seen = new Set<string>();
  normalized.forEach((name, i) => {
    if (name === '') errors[i] = 'mapRequired';
    else if (!MAP_NAME_PATTERN.test(name)) errors[i] = 'mapFormat';
    else if (seen.has(name)) errors[i] = 'mapDuplicate';
    seen.add(name);
  });
  if (values.length > MAP_POOL_SIZE || errors.some((e) => e !== null)) {
    return { ok: false, errors };
  }
  return { ok: true, value: normalized };
}

// ---------- tournament settings ----------

export type TournamentField =
  | 'name'
  | 'defaultMatchFormat'
  | 'finalMatchFormat'
  | 'maxTeams'
  | 'registrationOpenAt'
  | 'registrationCloseAt'
  | 'startsAt'
  | 'description'
  | 'mapPool';

export type TournamentErrorCode =
  | 'nameLength'
  | 'nameChars'
  | 'formatRequired'
  | 'maxTeamsRange'
  | 'dateInvalid'
  | 'closeBeforeOpen'
  | 'descriptionLength'
  | 'descriptionChars'
  | 'mapPoolInvalid';

export interface TournamentFormInput {
  name: string;
  defaultMatchFormat: string;
  /** '' = same as default. */
  finalMatchFormat: string;
  maxTeams: string;
  /** `datetime-local` values in UTC, or ''. */
  registrationOpenAt: string;
  registrationCloseAt: string;
  startsAt: string;
  description: string;
  mapPool: string[];
}

export type TournamentValidation =
  | { ok: true; value: CreateTournamentDto }
  | {
      ok: false;
      errors: Partial<Record<TournamentField, TournamentErrorCode>>;
      mapErrors: Array<MapPoolErrorCode | null>;
    };

const MATCH_FORMAT_SET: ReadonlySet<string> = new Set(['BO1', 'BO3', 'BO5']);

export function isMatchFormat(value: string): value is MatchFormat {
  return MATCH_FORMAT_SET.has(value);
}

/**
 * `datetime-local` value interpreted as **UTC** (the whole app displays UTC) → ISO string;
 * '' → null; malformed → undefined.
 */
export function utcInputToIso(value: string): string | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return undefined;
  const [y, mo, d, h, mi] = match.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const sec = match[6] ? Number(match[6]) : 0;
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d ||
    h > 23 ||
    mi > 59 ||
    sec > 59
  ) {
    return undefined;
  }
  return date.toISOString();
}

/** ISO string → `datetime-local` value in UTC ('' for null/invalid). */
export function isoToUtcInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16);
}

/** Validate the create/edit form (§3.1). Format is always SINGLE_ELIMINATION in M3. */
export function validateTournamentForm(input: TournamentFormInput): TournamentValidation {
  const errors: Partial<Record<TournamentField, TournamentErrorCode>> = {};

  const name = input.name.normalize('NFC').trim();
  const nameLength = textLength(name);
  if (nameLength < TOURNAMENT_NAME_MIN || nameLength > TOURNAMENT_NAME_MAX) {
    errors.name = 'nameLength';
  } else if (FORBIDDEN_NAME_CHARS.test(name) || !NAME_PATTERN.test(name)) {
    errors.name = 'nameChars';
  }

  if (!isMatchFormat(input.defaultMatchFormat)) errors.defaultMatchFormat = 'formatRequired';
  if (input.finalMatchFormat !== '' && !isMatchFormat(input.finalMatchFormat)) {
    errors.finalMatchFormat = 'formatRequired';
  }

  const maxTeamsText = input.maxTeams.trim();
  const maxTeams = /^\d{1,3}$/.test(maxTeamsText) ? Number.parseInt(maxTeamsText, 10) : NaN;
  if (!Number.isInteger(maxTeams) || maxTeams < MAX_TEAMS_MIN || maxTeams > MAX_TEAMS_MAX) {
    errors.maxTeams = 'maxTeamsRange';
  }

  const open = utcInputToIso(input.registrationOpenAt);
  const close = utcInputToIso(input.registrationCloseAt);
  const starts = utcInputToIso(input.startsAt);
  if (open === undefined) errors.registrationOpenAt = 'dateInvalid';
  if (close === undefined) errors.registrationCloseAt = 'dateInvalid';
  if (starts === undefined) errors.startsAt = 'dateInvalid';
  if (open && close && Date.parse(close) <= Date.parse(open)) {
    errors.registrationCloseAt = 'closeBeforeOpen';
  }

  const description = input.description.normalize('NFC').trim();
  if (textLength(description) > TOURNAMENT_DESCRIPTION_MAX)
    errors.description = 'descriptionLength';
  else if (FORBIDDEN_TEXT_CHARS.test(description)) errors.description = 'descriptionChars';

  const pool = validateMapPool(input.mapPool);
  if (!pool.ok) errors.mapPool = 'mapPoolInvalid';

  if (Object.keys(errors).length > 0 || !pool.ok) {
    return { ok: false, errors, mapErrors: pool.ok ? pool.value.map(() => null) : pool.errors };
  }
  return {
    ok: true,
    value: {
      name,
      format: 'SINGLE_ELIMINATION',
      defaultMatchFormat: input.defaultMatchFormat as MatchFormat,
      finalMatchFormat:
        input.finalMatchFormat === '' ? null : (input.finalMatchFormat as MatchFormat),
      maxTeams,
      registrationOpenAt: open ?? null,
      registrationCloseAt: close ?? null,
      startsAt: starts ?? null,
      description: description === '' ? null : description,
      mapPool: pool.value,
    },
  };
}

/** Map API `details[].field` to a tournament form field (`mapPool.3` → mapPool). */
export function tournamentFieldOf(apiField: string): TournamentField | null {
  const root = apiField.split(/[.[]/)[0] ?? '';
  const fields: readonly string[] = [
    'name',
    'defaultMatchFormat',
    'finalMatchFormat',
    'maxTeams',
    'registrationOpenAt',
    'registrationCloseAt',
    'startsAt',
    'description',
    'mapPool',
  ];
  return fields.includes(root) ? (root as TournamentField) : null;
}

// ---------- status transitions (§3) ----------

/**
 * Transitions an admin can request through `POST /admin/tournaments/:id/status`.
 * IN_PROGRESS is reached only by generate-bracket, COMPLETED only by completing the final.
 */
export function manualStatusTargets(status: TournamentStatus): TournamentStatus[] {
  switch (status) {
    case 'DRAFT':
      return ['REGISTRATION_OPEN', 'CANCELLED'];
    case 'REGISTRATION_OPEN':
      return ['REGISTRATION_CLOSED', 'CANCELLED'];
    case 'REGISTRATION_CLOSED':
    case 'IN_PROGRESS':
      return ['CANCELLED'];
    default:
      return [];
  }
}

/** Settings are editable only while DRAFT or REGISTRATION_OPEN (§3.1). */
export function canEditTournament(status: TournamentStatus): boolean {
  return status === 'DRAFT' || status === 'REGISTRATION_OPEN';
}

// ---------- roster selection (§4) ----------

export type RosterChoice = 'STARTER' | 'SUBSTITUTE' | 'NONE';
export type RosterSelectionErrorCode =
  'startersCount' | 'substitutesMax' | 'duplicatePlayer' | 'overlap';

export type RosterSelectionValidation =
  { ok: true; value: CreateRegistrationDto } | { ok: false; errors: RosterSelectionErrorCode[] };

/** Build `{ starters, substitutes }` from per-player choices (preserving list order). */
export function selectionToLists(
  order: readonly string[],
  choices: Readonly<Record<string, RosterChoice>>,
): { starters: string[]; substitutes: string[] } {
  return {
    starters: order.filter((id) => choices[id] === 'STARTER'),
    substitutes: order.filter((id) => choices[id] === 'SUBSTITUTE'),
  };
}

/** Exactly 5 distinct starters, ≤ 2 distinct substitutes, no player in both lists. */
export function validateRosterSelection(
  teamId: string,
  starters: readonly string[],
  substitutes: readonly string[],
): RosterSelectionValidation {
  const errors: RosterSelectionErrorCode[] = [];
  const starterSet = new Set(starters);
  const subSet = new Set(substitutes);
  if (starterSet.size !== starters.length || subSet.size !== substitutes.length) {
    errors.push('duplicatePlayer');
  }
  if (starters.some((id) => subSet.has(id))) errors.push('overlap');
  if (starterSet.size !== STARTERS_REQUIRED) errors.push('startersCount');
  if (subSet.size > SUBSTITUTES_MAX) errors.push('substitutesMax');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { teamId, starters: [...starters], substitutes: [...substitutes] } };
}

const INELIGIBLE_SET: ReadonlySet<string> = new Set(PLAYER_INELIGIBLE_REASONS);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Per-player reasons from a 409 PLAYER_INELIGIBLE (`details: [{ field: userId, message: REASON }]`).
 * Unknown reasons map to 'UNKNOWN'; malformed fields are ignored. Never renders server text.
 */
export function ineligiblePlayers(
  failure: Pick<ApiFailure, 'code' | 'details'> | null,
): Record<string, PlayerIneligibleReason | 'UNKNOWN'> {
  const result: Record<string, PlayerIneligibleReason | 'UNKNOWN'> = {};
  if (!failure || failure.code !== 'PLAYER_INELIGIBLE' || !failure.details) return result;
  for (const detail of failure.details) {
    if (!UUID.test(detail.field)) continue;
    result[detail.field.toLowerCase()] = INELIGIBLE_SET.has(detail.message)
      ? (detail.message as PlayerIneligibleReason)
      : 'UNKNOWN';
  }
  return result;
}

// ---------- seeding (§6) ----------

export type SeedErrorCode = 'seedRequired' | 'seedRange' | 'seedDuplicate';

export type SeedsValidation =
  | { ok: true; value: Array<{ registrationId: string; seed: number }> }
  | { ok: false; errors: Record<string, SeedErrorCode> };

/** Every APPROVED registration gets a unique integer seed 1..N. */
export function validateSeeds(
  registrationIds: readonly string[],
  values: Readonly<Record<string, string>>,
): SeedsValidation {
  const n = registrationIds.length;
  const errors: Record<string, SeedErrorCode> = {};
  const seen = new Map<number, string>();
  const seeds: Array<{ registrationId: string; seed: number }> = [];
  for (const id of registrationIds) {
    const raw = (values[id] ?? '').trim();
    if (raw === '') {
      errors[id] = 'seedRequired';
      continue;
    }
    const seed = /^\d{1,2}$/.test(raw) ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isInteger(seed) || seed < 1 || seed > n) {
      errors[id] = 'seedRange';
      continue;
    }
    if (seen.has(seed)) {
      errors[id] = 'seedDuplicate';
      continue;
    }
    seen.set(seed, id);
    seeds.push({ registrationId: id, seed });
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: seeds.sort((a, b) => a.seed - b.seed) };
}

// ---------- results (§9) ----------

export function winsNeeded(format: MatchFormat): number {
  return format === 'BO5' ? 3 : format === 'BO3' ? 2 : 1;
}

export type ScoreErrorCode = 'scoreRequired' | 'scoreInvalid' | 'winnerMismatch';

export type ScoreValidation =
  { ok: true; teamAScore: number; teamBScore: number } | { ok: false; error: ScoreErrorCode };

/**
 * Maps won must fit the format: BO1 1–0; BO3 2–0 / 2–1; BO5 3–0 / 3–1 / 3–2, and the selected
 * winner must hold the majority.
 */
export function validateSeriesScore(
  format: MatchFormat,
  winner: 'A' | 'B' | null,
  teamAScoreText: string,
  teamBScoreText: string,
): ScoreValidation {
  if (winner === null || teamAScoreText.trim() === '' || teamBScoreText.trim() === '') {
    return { ok: false, error: 'scoreRequired' };
  }
  const a = /^\d$/.test(teamAScoreText.trim()) ? Number(teamAScoreText.trim()) : NaN;
  const b = /^\d$/.test(teamBScoreText.trim()) ? Number(teamBScoreText.trim()) : NaN;
  if (!Number.isInteger(a) || !Number.isInteger(b)) return { ok: false, error: 'scoreInvalid' };
  const need = winsNeeded(format);
  const [w, l] = winner === 'A' ? [a, b] : [b, a];
  if (a === b || Math.max(a, b) !== need || Math.min(a, b) < 0 || Math.min(a, b) >= need) {
    return { ok: false, error: 'scoreInvalid' };
  }
  if (w !== need || l >= need) return { ok: false, error: 'winnerMismatch' };
  return { ok: true, teamAScore: a, teamBScore: b };
}

/** Build the override body after validation. */
export function buildResultOverride(
  winnerTeamId: string,
  score: { teamAScore: number; teamBScore: number },
  reason: string,
): ResultOverrideDto {
  return { winnerTeamId, teamAScore: score.teamAScore, teamBScore: score.teamBScore, reason };
}

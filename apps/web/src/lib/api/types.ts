/**
 * RAGE API v1 contract types for the web app.
 *
 * Resource shapes come from `@rage/api-client`, which is GENERATED from the API's OpenAPI
 * document — so any API/web contract drift is a compile error here. Pages import only
 * from this module. Web-specific helpers (ApiResult, list params) are defined below.
 */
import type {
  ApiError,
  MatchFormat,
  MatchMapStatus,
  MatchStatus,
  MembershipRole,
  TournamentStatus,
} from '@rage/api-client';

export type {
  MatchDetail,
  MatchFormat,
  MatchMap,
  MatchMapStatus,
  MatchStatus,
  MatchSummary,
  MetaResponse,
  Paginated,
  PlayerDetail,
  PlayerSummary,
  ReadinessResponse,
  TeamDetail,
  TeamRef,
  TeamSummary,
  TournamentDetail,
  TournamentRef,
  TournamentStatus,
  TournamentSummary,
} from '@rage/api-client';

export type ApiErrorBody = ApiError;
export type RosterRole = MembershipRole;
export type { TeamRosterEntry as RosterEntry } from '@rage/api-client';
export type FeatureStatus = 'not_implemented' | 'configured' | 'unconfigured';
export type DependencyStatus = 'up' | 'down';

/**
 * Compile-time guard: the tuple must list every member of the generated union, no more.
 * (If the API adds/removes a status, this file stops compiling.)
 */
type Exhaustive<Union, Tuple extends readonly unknown[]> = [Union] extends [Tuple[number]]
  ? [Tuple[number]] extends [Union]
    ? Tuple
    : never
  : never;

const tournamentStatuses = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export const TOURNAMENT_STATUSES: Exhaustive<TournamentStatus, typeof tournamentStatuses> =
  tournamentStatuses;

const matchStatuses = [
  'CREATED',
  'SERVER_ASSIGNED',
  'PREPARING',
  'WARMUP',
  'READY_CHECK',
  'KNIFE',
  'LIVE',
  'PAUSED',
  'MAP_FINISHED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'DISPUTED',
] as const;
export const MATCH_STATUSES: Exhaustive<MatchStatus, typeof matchStatuses> = matchStatuses;

const matchFormats = ['BO1', 'BO3', 'BO5'] as const;
export const MATCH_FORMATS: Exhaustive<MatchFormat, typeof matchFormats> = matchFormats;

const matchMapStatuses = [
  'PENDING',
  'WARMUP',
  'KNIFE',
  'LIVE',
  'PAUSED',
  'FINISHED',
  'CANCELLED',
] as const;
export const MATCH_MAP_STATUSES: Exhaustive<MatchMapStatus, typeof matchMapStatuses> =
  matchMapStatuses;

// ---------- request params ----------
export interface ListParams {
  page?: number;
  pageSize?: number;
  q?: string;
}

export interface TournamentListParams extends ListParams {
  status?: TournamentStatus;
}

// ---------- result type ----------
export type ApiFailureKind = 'not_found' | 'unavailable' | 'error';

export interface ApiFailure {
  ok: false;
  kind: ApiFailureKind;
  /** HTTP status when a response was received. */
  status?: number;
  /** Safe, user-presentable summary (never a stack trace). */
  message: string;
  requestId?: string;
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

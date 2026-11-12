/**
 * Typed client for the RAGE Platform API (v1).
 *
 * `schema.ts` is GENERATED from `openapi.json`, which is emitted by the API itself
 * (`pnpm openapi:generate`). Do not edit generated files by hand; CI fails on drift.
 */
import createClient, { type Client, type ClientOptions } from 'openapi-fetch';
import type { components, operations, paths } from './schema.js';

export type { components, operations, paths };

type Schemas = components['schemas'];

export type ApiError = Schemas['ApiErrorDto'];
export type ApiErrorDetail = Schemas['ApiErrorDetailDto'];
export type MetaResponse = Schemas['MetaDto'];
export type ReadinessResponse = Schemas['ReadinessDto'];
export type LivenessResponse = Schemas['LivenessDto'];

export type PlayerSummary = Schemas['PlayerSummaryDto'];
export type PlayerDetail = Schemas['PlayerDetailDto'];
export type TeamSummary = Schemas['TeamSummaryDto'];
export type TeamDetail = Schemas['TeamDetailDto'];
export type TeamRosterEntry = Schemas['TeamRosterEntryDto'];
export type TournamentSummary = Schemas['TournamentSummaryDto'];
export type TournamentDetail = Schemas['TournamentDetailDto'];
export type MatchSummary = Schemas['MatchSummaryDto'];
export type MatchDetail = Schemas['MatchDetailDto'];
export type MatchMap = Schemas['MatchMapDto'];
export type TeamRef = Schemas['TeamRefDto'];
export type TournamentRef = Schemas['TournamentRefDto'];

export type MatchStatus = MatchSummary['status'];
export type MatchFormat = MatchSummary['format'];
export type TournamentStatus = TournamentSummary['status'];
export type MembershipRole = TeamRosterEntry['role'];
export type MatchMapStatus = MatchMap['status'];

/** Generic pagination envelope (`{ items, page, pageSize, total }`). */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type RageApiClient = Client<paths>;

/**
 * Create a typed client.
 * @param baseUrl API base including the version prefix, e.g. `http://localhost:4000/api/v1`.
 *
 * Generated paths include the `/api/v1` prefix; this helper strips it so callers pass
 * the configured base URL (which may point at a reverse proxy) unchanged.
 */
export function createApiClient(
  baseUrl: string,
  options: Omit<ClientOptions, 'baseUrl'> = {},
): RageApiClient {
  const origin = baseUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return createClient<paths>({ ...options, baseUrl: origin });
}

/** Type guard for the normalized API error envelope. */
export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiError).statusCode === 'number' &&
    typeof (value as ApiError).message === 'string' &&
    typeof (value as ApiError).requestId === 'string'
  );
}

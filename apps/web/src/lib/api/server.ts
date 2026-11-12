import 'server-only';

import { cache } from 'react';
import { apiGet, DEFAULT_API_BASE_URL, type QueryValue } from './http';
import type {
  ApiResult,
  ListParams,
  MatchDetail,
  MatchSummary,
  MetaResponse,
  Paginated,
  PlayerDetail,
  PlayerSummary,
  ReadinessResponse,
  TeamDetail,
  TeamSummary,
  TournamentDetail,
  TournamentListParams,
  TournamentSummary,
} from './types';

/**
 * Server-only data access for the RAGE API.
 * Pages and components must use these functions — never `fetch` directly —
 * so the transport can later be swapped to `@rage/api-client` in one place.
 * Each function is wrapped in React `cache` so `generateMetadata` and the page
 * share one request per render.
 */

function baseUrl(): string {
  return process.env.API_INTERNAL_URL || DEFAULT_API_BASE_URL;
}

function get<T>(path: string, query?: Record<string, QueryValue>, acceptStatuses?: number[]) {
  return apiGet<T>(path, {
    baseUrl: baseUrl(),
    ...(query ? { query } : {}),
    ...(acceptStatuses ? { acceptStatuses } : {}),
  }).then((result) => {
    if (!result.ok && result.kind !== 'not_found') {
      // Server log only; the client never sees internal details.
      console.error(
        `[api] GET ${path} failed: ${result.kind} status=${result.status ?? '-'} requestId=${result.requestId ?? '-'}`,
      );
    }
    return result;
  });
}

function listQuery(params: ListParams = {}): Record<string, QueryValue> {
  return { page: params.page, pageSize: params.pageSize, q: params.q };
}

const seg = (value: string) => encodeURIComponent(value);

/** Same rules as the API (apps/api SLUG_PATTERN / ParseUUIDPipe). */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Route params are validated BEFORE building an upstream path, so values such as `.`
 * or `..` can never be normalized by `new URL()` into a different API resource
 * (security LOW-7). Invalid identifiers are simply "not found"; no request is made.
 */
function notFoundWithoutFetch<T>(): Promise<ApiResult<T>> {
  return Promise.resolve({
    ok: false,
    kind: 'not_found',
    message: 'The requested resource was not found.',
  });
}

function bySlug<T>(collection: string, slug: string): Promise<ApiResult<T>> {
  return SLUG_PATTERN.test(slug) ? get<T>(`/${collection}/${seg(slug)}`) : notFoundWithoutFetch();
}

export const getMeta = cache((): Promise<ApiResult<MetaResponse>> => get('/meta'));

/** 503 is a valid readiness payload (`status: "error"`). */
export const getReadiness = cache((): Promise<ApiResult<ReadinessResponse>> =>
  get('/health/ready', undefined, [503]),
);

export const getPlayers = cache(
  (params?: ListParams): Promise<ApiResult<Paginated<PlayerSummary>>> =>
    get('/players', listQuery(params)),
);

export const getPlayer = cache((slug: string): Promise<ApiResult<PlayerDetail>> =>
  bySlug('players', slug),
);

export const getTeams = cache((params?: ListParams): Promise<ApiResult<Paginated<TeamSummary>>> =>
  get('/teams', listQuery(params)),
);

export const getTeam = cache((slug: string): Promise<ApiResult<TeamDetail>> =>
  bySlug('teams', slug),
);

export const getTournaments = cache(
  (params?: TournamentListParams): Promise<ApiResult<Paginated<TournamentSummary>>> =>
    get('/tournaments', { ...listQuery(params), status: params?.status }),
);

export const getTournament = cache((slug: string): Promise<ApiResult<TournamentDetail>> =>
  bySlug('tournaments', slug),
);

export const getMatches = cache(
  (params?: ListParams): Promise<ApiResult<Paginated<MatchSummary>>> =>
    get('/matches', listQuery(params)),
);

export const getMatch = cache((id: string): Promise<ApiResult<MatchDetail>> =>
  UUID_PATTERN.test(id) ? get(`/matches/${seg(id)}`) : notFoundWithoutFetch(),
);

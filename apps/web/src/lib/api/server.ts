import 'server-only';

import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { isWellFormedToken, SESSION_COOKIE } from '@/lib/auth/cookies';
import { apiGet, DEFAULT_API_BASE_URL, type QueryValue } from './http';
import { buildServerHeaders, parseTrustedHops } from './ssr-headers';
import type {
  AdminTeamApplicationDto,
  AdminTeamApplicationListParams,
  AdminUserDto,
  AdminUserListParams,
  ApiResult,
  AuditListParams,
  AuditLogDto,
  ListParams,
  MatchDetail,
  InvitationStatus,
  MeDtoM2,
  MatchSummary,
  MyInvitationDto,
  MetaResponse,
  Paginated,
  PaginatedResponse,
  PlayerDetail,
  PlayerSummary,
  ReadinessResponse,
  RosterHistoryEntryDto,
  TeamApplicationDto,
  TeamApplicationStatus,
  TeamDetail,
  TeamManageDto,
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

interface IncomingRequest {
  forwardedFor: string | null;
  realIp: string | null;
  sessionToken: string | null;
}

/**
 * Visitor context of the current request. Outside a request scope (unit tests, build-time)
 * `headers()`/`cookies()` throw — then nothing is forwarded.
 */
async function incomingRequest(): Promise<IncomingRequest> {
  try {
    const [headerStore, cookieStore] = await Promise.all([headers(), cookies()]);
    return {
      forwardedFor: headerStore.get('x-forwarded-for'),
      realIp: headerStore.get('x-real-ip'),
      sessionToken: cookieStore.get(SESSION_COOKIE)?.value ?? null,
    };
  } catch {
    return { forwardedFor: null, realIp: null, sessionToken: null };
  }
}

interface GetOptions {
  acceptStatuses?: number[];
  /** Forward the visitor's `rage_session` cookie (only /me and admin reads). */
  withSession?: boolean;
}

async function get<T>(
  path: string,
  query?: Record<string, QueryValue>,
  options: GetOptions = {},
): Promise<ApiResult<T>> {
  const incoming = await incomingRequest();
  const result = await apiGet<T>(path, {
    baseUrl: baseUrl(),
    ...(query ? { query } : {}),
    ...(options.acceptStatuses ? { acceptStatuses: options.acceptStatuses } : {}),
    headers: buildServerHeaders({
      // Server-only secret: this module imports 'server-only', so it never reaches the client.
      ssrToken: process.env.INTERNAL_SSR_TOKEN,
      forwardedFor: incoming.forwardedFor,
      realIp: incoming.realIp,
      // Reverse proxies in front of the web server; 0 = never forward a client IP (gate M-2).
      trustedHops: parseTrustedHops(process.env.WEB_TRUST_PROXY_HOPS),
      sessionToken: incoming.sessionToken,
      withSession: options.withSession === true,
    }),
  });
  if (!result.ok && result.kind !== 'not_found' && result.kind !== 'unauthenticated') {
    // Server log only; the client never sees internal details.
    console.error(
      `[api] GET ${path} failed: ${result.kind} status=${result.status ?? '-'} requestId=${result.requestId ?? '-'}`,
    );
  }
  return result;
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
  get('/health/ready', undefined, { acceptStatuses: [503] }),
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

// ---------- session-aware reads (M1) ----------

function unauthenticatedWithoutFetch<T>(): ApiResult<T> {
  return { ok: false, kind: 'unauthenticated', message: 'Sign-in required.' };
}

/**
 * Current user from `GET /me`, forwarding only the visitor's `rage_session` cookie.
 * No (well-formed) session cookie → `unauthenticated` without any API request; 401 → `unauthenticated`.
 */
export const getMe = cache(async (): Promise<ApiResult<MeDtoM2>> => {
  const { sessionToken } = await incomingRequest();
  if (!isWellFormedToken(sessionToken)) return unauthenticatedWithoutFetch();
  return get<MeDtoM2>('/me', undefined, { withSession: true });
});

export const getAdminUsers = cache(
  (params?: AdminUserListParams): Promise<ApiResult<PaginatedResponse<AdminUserDto>>> =>
    get('/admin/users', listQuery(params), { withSession: true }),
);

/** Audit action filter values are dotted snake-case identifiers (e.g. `role_grant.create`). */
export const AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/;

export const getAuditLogs = cache(
  (params?: AuditListParams): Promise<ApiResult<PaginatedResponse<AuditLogDto>>> => {
    const action =
      params?.action && params.action.length <= 64 && AUDIT_ACTION_PATTERN.test(params.action)
        ? params.action
        : undefined;
    const actorUserId =
      params?.actorUserId && UUID_PATTERN.test(params.actorUserId) ? params.actorUserId : undefined;
    return get(
      '/admin/audit',
      { page: params?.page, pageSize: params?.pageSize, action, actorUserId },
      { withSession: true },
    );
  },
);

// ---------- teams, applications, invitations (M2, docs/TEAMS.md §4) ----------

const TEAM_APPLICATION_STATUS_SET: ReadonlySet<string> = new Set([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
]);
const INVITATION_STATUS_SET: ReadonlySet<string> = new Set([
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'REVOKED',
  'EXPIRED',
]);

/**
 * Read that REQUIRES a session: forwards only `rage_session`, and answers `unauthenticated`
 * without any API request when the visitor has no well-formed session cookie.
 */
async function sessionGet<T>(path: string, query?: Record<string, QueryValue>) {
  const { sessionToken } = await incomingRequest();
  if (!isWellFormedToken(sessionToken)) return unauthenticatedWithoutFetch<T>();
  return get<T>(path, query, { withSession: true });
}

/** Own applications, newest first (max 20). */
export const getMyTeamApplications = cache((): Promise<ApiResult<TeamApplicationDto[]>> =>
  sessionGet('/me/team-applications'),
);

/** Own invitations filtered by status (API default PENDING; max 50). */
export const getMyInvitations = cache(
  (status?: InvitationStatus): Promise<ApiResult<MyInvitationDto[]>> =>
    sessionGet('/me/invitations', {
      status: status && INVITATION_STATUS_SET.has(status) ? status : undefined,
    }),
);

/** SUPER_ADMIN queue (API default status PENDING, oldest first). */
export const getAdminTeamApplications = cache(
  (
    params: AdminTeamApplicationListParams = {},
  ): Promise<ApiResult<PaginatedResponse<AdminTeamApplicationDto>>> =>
    sessionGet('/admin/team-applications', {
      status:
        params.status && TEAM_APPLICATION_STATUS_SET.has(params.status)
          ? (params.status satisfies TeamApplicationStatus)
          : undefined,
      page: params.page,
      pageSize: params.pageSize,
    }),
);

/** Team operator view; 403 for everyone else (the team itself stays public). */
export const getTeamManage = cache((slug: string): Promise<ApiResult<TeamManageDto>> =>
  SLUG_PATTERN.test(slug) ? sessionGet(`/teams/${seg(slug)}/manage`) : notFoundWithoutFetch(),
);

/** Public roster history (newest first). Never forwards the session cookie. */
export const getTeamRosterHistory = cache(
  (
    slug: string,
    page?: number,
    pageSize?: number,
  ): Promise<ApiResult<PaginatedResponse<RosterHistoryEntryDto>>> =>
    SLUG_PATTERN.test(slug)
      ? get(`/teams/${seg(slug)}/roster-history`, { page, pageSize })
      : notFoundWithoutFetch(),
);

/**
 * Browser-side calls to the RAGE API (client components only).
 * Cookie-authenticated, so every unsafe request sends `credentials: 'include'` and the
 * session-bound CSRF token from the `rage_csrf` cookie (docs/AUTH.md §5).
 * M2 mutations also send an `Idempotency-Key` (docs/TEAMS.md §7): a fresh UUID per user intent,
 * reused only for the single automatic retry of that same intent.
 * The API remains the authority for authentication, CSRF and authorization.
 */
import { CSRF_HEADER, getCsrfToken } from '@/lib/auth/cookies';
import { apiSend, type HttpMethod } from './http';
import { publicApiBaseUrl } from './public-url';
import type {
  ApiFailure,
  ApiResult,
  ApproveTeamApplicationRequest,
  CreateInvitationRequest,
  CreateTeamApplicationRequest,
  GrantRoleRequest,
  MeDto,
  MyInvitationDto,
  RejectTeamApplicationRequest,
  RemoveMemberRequest,
  RevokeInvitationRequest,
  RevokeRoleRequest,
  RoleGrantDto,
  TeamApplicationDto,
  TeamDetailM2,
  TeamInvitationDto,
  TransferCaptainRequest,
  UpdateProfileRequest,
} from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
/** TEAMS.md §7: 16–64 chars `[A-Za-z0-9_-]`. */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/** Longest wait honoured before the automatic retry. */
const MAX_RETRY_DELAY_MS = 3000;

function invalidId<T>(): Promise<ApiResult<T>> {
  return Promise.resolve({ ok: false, kind: 'not_found', message: 'Invalid identifier.' });
}

export interface MutationOptions {
  fetchImpl?: typeof fetch;
  /** Override the cookie source (tests). */
  cookieString?: string;
  /** Use a caller-managed idempotency key (must match TEAMS.md §7, else a fresh one is used). */
  idempotencyKey?: string;
  /** Override the retry delay (tests). */
  sleep?: (ms: number) => Promise<void>;
}

/** A fresh idempotency key for one user intent. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function send<T>(
  method: HttpMethod,
  path: string,
  body: unknown,
  options: MutationOptions = {},
  extraHeaders: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const csrf = getCsrfToken(options.cookieString);
  return apiSend<T>(path, {
    method,
    baseUrl: publicApiBaseUrl(),
    credentials: 'include',
    headers: { ...(csrf ? { [CSRF_HEADER]: csrf } : {}), ...extraHeaders },
    ...(body !== undefined ? { body } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

/**
 * Whether a failed idempotent mutation may be retried automatically with the SAME key:
 * the request may not have reached the API (network error / timeout: no HTTP status), or the
 * API is still processing the same key (409 IDEMPOTENCY_IN_PROGRESS).
 */
export function isRetryableIdempotentFailure(failure: ApiFailure): boolean {
  if (failure.kind === 'unavailable' && failure.status === undefined) return true;
  return failure.kind === 'conflict' && failure.code === 'IDEMPOTENCY_IN_PROGRESS';
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * POST with an `Idempotency-Key`. One automatic retry (same key, same body) for transient
 * outcomes; every other result is returned as-is. Never throws.
 */
async function sendIdempotent<T>(
  path: string,
  body: unknown,
  options: MutationOptions = {},
): Promise<ApiResult<T>> {
  const key =
    options.idempotencyKey && IDEMPOTENCY_KEY_PATTERN.test(options.idempotencyKey)
      ? options.idempotencyKey
      : newIdempotencyKey();
  const headers = { [IDEMPOTENCY_HEADER]: key };
  const first = await send<T>('POST', path, body, options, headers);
  if (first.ok || !isRetryableIdempotentFailure(first)) return first;
  const delayMs = Math.min((first.retryAfterSeconds ?? 1) * 1000, MAX_RETRY_DELAY_MS);
  await (options.sleep ?? defaultSleep)(delayMs);
  return send<T>('POST', path, body, options, headers);
}

/** `POST /auth/logout` (204, idempotent). */
export function logout(options?: MutationOptions): Promise<ApiResult<null>> {
  return send<null>('POST', '/auth/logout', undefined, options);
}

/** `PATCH /me/profile` → updated `MeDto`. */
export function updateProfile(
  body: UpdateProfileRequest,
  options?: MutationOptions,
): Promise<ApiResult<MeDto>> {
  return send<MeDto>('PATCH', '/me/profile', body, options);
}

/** `POST /admin/users/:id/roles` → 201 `RoleGrantDto` (409 on active duplicate). */
export function grantRole(
  userId: string,
  body: GrantRoleRequest,
  options?: MutationOptions,
): Promise<ApiResult<RoleGrantDto>> {
  if (!UUID.test(userId)) return invalidId();
  return send<RoleGrantDto>('POST', `/admin/users/${userId}/roles`, body, options);
}

/** `POST /admin/users/:id/roles/:grantId/revoke` → `RoleGrantDto` (409 for own last SUPER_ADMIN). */
export function revokeRole(
  userId: string,
  grantId: string,
  body: RevokeRoleRequest,
  options?: MutationOptions,
): Promise<ApiResult<RoleGrantDto>> {
  if (!UUID.test(userId) || !UUID.test(grantId)) return invalidId();
  return send<RoleGrantDto>(
    'POST',
    `/admin/users/${userId}/roles/${grantId}/revoke`,
    body,
    options,
  );
}

// ---------- M2: applications, invitations, rosters (docs/TEAMS.md §4) ----------

/** `POST /team-applications` → 201 `TeamApplicationDto`. */
export function submitTeamApplication(
  body: CreateTeamApplicationRequest,
  options?: MutationOptions,
): Promise<ApiResult<TeamApplicationDto>> {
  return sendIdempotent('/team-applications', body, options);
}

/** `POST /team-applications/:id/withdraw` → `TeamApplicationDto` (WITHDRAWN). */
export function withdrawTeamApplication(
  applicationId: string,
  options?: MutationOptions,
): Promise<ApiResult<TeamApplicationDto>> {
  if (!UUID.test(applicationId)) return invalidId();
  return sendIdempotent(`/team-applications/${applicationId}/withdraw`, undefined, options);
}

/** `POST /admin/team-applications/:id/approve` → `TeamApplicationDto` (APPROVED). */
export function approveTeamApplication(
  applicationId: string,
  body: ApproveTeamApplicationRequest,
  options?: MutationOptions,
): Promise<ApiResult<TeamApplicationDto>> {
  if (!UUID.test(applicationId)) return invalidId();
  return sendIdempotent(`/admin/team-applications/${applicationId}/approve`, body, options);
}

/** `POST /admin/team-applications/:id/reject` → `TeamApplicationDto` (REJECTED). */
export function rejectTeamApplication(
  applicationId: string,
  body: RejectTeamApplicationRequest,
  options?: MutationOptions,
): Promise<ApiResult<TeamApplicationDto>> {
  if (!UUID.test(applicationId)) return invalidId();
  return sendIdempotent(`/admin/team-applications/${applicationId}/reject`, body, options);
}

/** `POST /teams/:teamId/invitations` → 201 `TeamInvitationDto`. */
export function inviteToTeam(
  teamId: string,
  body: CreateInvitationRequest,
  options?: MutationOptions,
): Promise<ApiResult<TeamInvitationDto>> {
  if (!UUID.test(teamId)) return invalidId();
  return sendIdempotent(`/teams/${teamId}/invitations`, body, options);
}

/** `POST /teams/:teamId/invitations/:invitationId/revoke` → `TeamInvitationDto` (REVOKED). */
export function revokeTeamInvitation(
  teamId: string,
  invitationId: string,
  body: RevokeInvitationRequest,
  options?: MutationOptions,
): Promise<ApiResult<TeamInvitationDto>> {
  if (!UUID.test(teamId) || !UUID.test(invitationId)) return invalidId();
  return sendIdempotent(`/teams/${teamId}/invitations/${invitationId}/revoke`, body, options);
}

/** `POST /teams/:teamId/members/:userId/remove` → 204. */
export function removeTeamMember(
  teamId: string,
  userId: string,
  body: RemoveMemberRequest,
  options?: MutationOptions,
): Promise<ApiResult<null>> {
  if (!UUID.test(teamId) || !UUID.test(userId)) return invalidId();
  return sendIdempotent(`/teams/${teamId}/members/${userId}/remove`, body, options);
}

/** `POST /teams/:teamId/leave` → 204 (captain → 409 CAPTAIN_MUST_TRANSFER). */
export function leaveTeam(teamId: string, options?: MutationOptions): Promise<ApiResult<null>> {
  if (!UUID.test(teamId)) return invalidId();
  return sendIdempotent(`/teams/${teamId}/leave`, undefined, options);
}

/** `POST /teams/:teamId/transfer-captain` → `TeamDetailDto`. */
export function transferCaptain(
  teamId: string,
  body: TransferCaptainRequest,
  options?: MutationOptions,
): Promise<ApiResult<TeamDetailM2>> {
  if (!UUID.test(teamId) || !UUID.test(body.newCaptainUserId)) return invalidId();
  return sendIdempotent(`/teams/${teamId}/transfer-captain`, body, options);
}

/** `POST /invitations/:id/accept` → `MyInvitationDto` (ACCEPTED). */
export function acceptInvitation(
  invitationId: string,
  options?: MutationOptions,
): Promise<ApiResult<MyInvitationDto>> {
  if (!UUID.test(invitationId)) return invalidId();
  return sendIdempotent(`/invitations/${invitationId}/accept`, undefined, options);
}

/** `POST /invitations/:id/decline` → `MyInvitationDto` (DECLINED). */
export function declineInvitation(
  invitationId: string,
  options?: MutationOptions,
): Promise<ApiResult<MyInvitationDto>> {
  if (!UUID.test(invitationId)) return invalidId();
  return sendIdempotent(`/invitations/${invitationId}/decline`, undefined, options);
}

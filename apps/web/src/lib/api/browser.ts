/**
 * Browser-side calls to the RAGE API (client components only).
 * Cookie-authenticated, so every unsafe request sends `credentials: 'include'` and the
 * session-bound CSRF token from the `rage_csrf` cookie (docs/AUTH.md §5).
 * The API remains the authority for authentication, CSRF and authorization.
 */
import { CSRF_HEADER, getCsrfToken } from '@/lib/auth/cookies';
import { apiSend, type HttpMethod } from './http';
import { publicApiBaseUrl } from './public-url';
import type {
  ApiResult,
  GrantRoleRequest,
  MeDto,
  RevokeRoleRequest,
  RoleGrantDto,
  UpdateProfileRequest,
} from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidId<T>(): Promise<ApiResult<T>> {
  return Promise.resolve({ ok: false, kind: 'not_found', message: 'Invalid identifier.' });
}

export interface MutationOptions {
  fetchImpl?: typeof fetch;
  /** Override the cookie source (tests). */
  cookieString?: string;
}

function send<T>(
  method: HttpMethod,
  path: string,
  body: unknown,
  options: MutationOptions = {},
): Promise<ApiResult<T>> {
  const csrf = getCsrfToken(options.cookieString);
  return apiSend<T>(path, {
    method,
    baseUrl: publicApiBaseUrl(),
    credentials: 'include',
    headers: csrf ? { [CSRF_HEADER]: csrf } : {},
    ...(body !== undefined ? { body } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
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

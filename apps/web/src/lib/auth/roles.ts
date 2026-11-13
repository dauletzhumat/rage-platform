import type { ApiResult, MeDto, MeRole, RoleType } from '@/lib/api/types';

/** Roles that open the admin area (UX only — the API authorises every request). */
export const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'TOURNAMENT_ADMIN',
  'MATCH_ADMIN',
] as const satisfies readonly RoleType[];

/** Roles a SUPER_ADMIN can grant from /admin/users in M1 (GLOBAL scope only). */
export const GRANTABLE_ROLES = [
  'SUPER_ADMIN',
  'TOURNAMENT_ADMIN',
  'MATCH_ADMIN',
  'OBSERVER',
] as const satisfies readonly RoleType[];

export function hasAnyAdminRole(roles: readonly Pick<MeRole, 'role'>[]): boolean {
  return roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r.role));
}

export function isSuperAdmin(roles: readonly Pick<MeRole, 'role' | 'scopeType'>[]): boolean {
  return roles.some((r) => r.role === 'SUPER_ADMIN' && r.scopeType === 'GLOBAL');
}

export type AdminAccess =
  | { kind: 'redirect_login' }
  | { kind: 'forbidden' }
  | { kind: 'failure'; result: Exclude<ApiResult<MeDto>, { ok: true }> }
  | { kind: 'allowed'; me: MeDto; superAdmin: boolean };

/**
 * Decide what the admin layout renders for a `getMe()` result:
 * no session → login redirect; signed in without an admin role → 403 state (no data);
 * API trouble → failure state; otherwise allowed.
 */
export function resolveAdminAccess(me: ApiResult<MeDto>): AdminAccess {
  if (!me.ok) {
    return me.kind === 'unauthenticated'
      ? { kind: 'redirect_login' }
      : { kind: 'failure', result: me };
  }
  if (!hasAnyAdminRole(me.data.roles)) return { kind: 'forbidden' };
  return { kind: 'allowed', me: me.data, superAdmin: isSuperAdmin(me.data.roles) };
}

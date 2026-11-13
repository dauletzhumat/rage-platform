import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { type RoleType } from '@rage/db';
import { ApiErrorDto } from '../common/errors/api-error.js';
import { CsrfGuard, Roles, RolesGuard, SessionGuard } from './guards.js';

/** OpenAPI security scheme names (registered in `buildOpenApiDocument`). */
export const SESSION_SECURITY = 'session';
export const CSRF_SECURITY = 'csrf';

/**
 * Cookie-authenticated route. Guard order: (global throttle) → session → CSRF.
 * `CsrfGuard` is a no-op on safe methods, so every authenticated route gets it — an unsafe
 * handler can never be added without CSRF protection.
 */
export function Authenticated(options: { unsafe?: boolean } = {}) {
  return applyDecorators(
    UseGuards(SessionGuard, CsrfGuard),
    options.unsafe
      ? ApiSecurity({ [SESSION_SECURITY]: [], [CSRF_SECURITY]: [] })
      : ApiCookieAuth(SESSION_SECURITY),
    ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'No valid session' }),
    ...(options.unsafe
      ? [ApiForbiddenResponse({ type: ApiErrorDto, description: 'CSRF validation failed' })]
      : []),
  );
}

export const UNGUARDED_UNSAFE_ROUTE = 'rage:unguarded-unsafe-route';

/**
 * Explicit, documented exemption from the "every unsafe handler has SessionGuard → CsrfGuard"
 * rule enforced by `test/unit/auth-wiring.test.ts`. Only for routes that cannot carry a session
 * by design (none exist today: Steam sign-in uses GET). The reason is mandatory and reviewed.
 */
export function AllowUnguardedUnsafeRoute(reason: string) {
  if (reason.trim().length < 10) throw new Error('AllowUnguardedUnsafeRoute needs a real reason');
  return SetMetadata(UNGUARDED_UNSAFE_ROUTE, reason);
}

/** Session → CSRF → role check (roles from active GLOBAL grants only). */
export function RequireRoles(roles: RoleType[], options: { unsafe?: boolean } = {}) {
  return applyDecorators(
    UseGuards(SessionGuard, CsrfGuard, RolesGuard),
    Roles(...roles),
    options.unsafe
      ? ApiSecurity({ [SESSION_SECURITY]: [], [CSRF_SECURITY]: [] })
      : ApiCookieAuth(SESSION_SECURITY),
    ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'No valid session' }),
    ApiForbiddenResponse({
      type: ApiErrorDto,
      description: options.unsafe ? 'Missing role or CSRF validation failed' : 'Missing role',
    }),
  );
}

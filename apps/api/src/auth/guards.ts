import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type RoleType } from '@rage/db';
import type { Request, Response } from 'express';
import { API_ERROR_CODES, errorBody } from '../common/errors/api-error.js';
import { ENV } from '../config/config.module.js';
import { type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { CSRF_HEADER, SESSION_COOKIE } from './auth.constants.js';
import { readCookie } from './cookies.js';
import { safeEqual } from './crypto.js';
import { type AuthContext, SessionService } from './session.service.js';

export type AuthedRequest = Request & { auth?: AuthContext };

const OPTIONAL_SESSION = 'rage:optional-session';
const ROLES = 'rage:roles';

/** Session is validated if present, but its absence is not an error (e.g. logout). */
export const OptionalSession = () => SetMetadata(OPTIONAL_SESSION, true);
/** Requires at least one of these active GLOBAL role grants. */
export const Roles = (...roles: RoleType[]) => SetMetadata(ROLES, roles);

/** Injects the authenticated principal (set by `SessionGuard`). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext | undefined =>
    ctx.switchToHttp().getRequest<AuthedRequest>().auth,
);

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 401 unless the `rage_session` cookie maps to a usable session. Sets `Cache-Control: no-store`. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const auth = await this.sessions.validate(readCookie(req, SESSION_COOKIE));
    if (auth) {
      req.auth = auth;
      return true;
    }
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_SESSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (optional) return true;
    throw new UnauthorizedException(
      errorBody('Authentication required', API_ERROR_CODES.unauthenticated),
    );
  }
}

/** Origin of the request from `Origin`, else `Referer`; `undefined` if absent/unparseable. */
export function requestOrigin(req: Pick<Request, 'headers'>): string | undefined {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin) {
    if (origin === 'null') return undefined;
    try {
      return new URL(origin).origin;
    } catch {
      return undefined;
    }
  }
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * CSRF (AUTH.md §5): on unsafe methods requires `x-csrf-token` == HMAC(secret, session id)
 * and an allowlisted Origin/Referer. Must run after `SessionGuard`.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
    @Inject(ENV) env: Env,
  ) {
    this.allowedOrigins = new Set(
      env.API_CORS_ORIGINS.map((o) => {
        try {
          return new URL(o).origin;
        } catch {
          return o;
        }
      }),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return true;
    if (!req.auth) {
      const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_SESSION, [
        context.getHandler(),
        context.getClass(),
      ]);
      // No session ⇒ nothing to protect on an optional-session route (e.g. logout clears
      // cookies only). Anywhere else a missing principal is a wiring error: fail closed.
      if (optional) return true;
      throw new ForbiddenException(errorBody('CSRF validation failed', API_ERROR_CODES.csrfFailed));
    }
    const origin = requestOrigin(req);
    if (!origin || !this.allowedOrigins.has(origin)) {
      throw new ForbiddenException(errorBody('CSRF validation failed', API_ERROR_CODES.csrfFailed));
    }
    const expected = this.sessions.csrfTokenFor(req.auth.sessionId);
    const header = req.headers[CSRF_HEADER];
    const provided = Array.isArray(header) ? undefined : header;
    if (!expected || !safeEqual(provided, expected)) {
      throw new ForbiddenException(errorBody('CSRF validation failed', API_ERROR_CODES.csrfFailed));
    }
    return true;
  }
}

/** Loads active GLOBAL grants of the user. */
export async function activeGlobalRoles(
  prisma: PrismaService,
  userId: string,
): Promise<Set<RoleType>> {
  const grants = await prisma.client.userRoleGrant.findMany({
    where: { userId, revokedAt: null, scopeType: 'GLOBAL' },
    select: { role: true },
  });
  return new Set(grants.map((g) => g.role));
}

/** 403 unless the principal holds one of the `@Roles(...)`. Roles come only from the DB. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RoleType[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      // A RolesGuard without @Roles is a wiring mistake: deny rather than allow.
      throw new ForbiddenException(
        errorBody('Insufficient permissions', API_ERROR_CODES.forbiddenRole),
      );
    }
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.auth)
      throw new UnauthorizedException(
        errorBody('Authentication required', API_ERROR_CODES.unauthenticated),
      );
    const roles = await activeGlobalRoles(this.prisma, req.auth.userId);
    if (!required.some((r) => roles.has(r))) {
      throw new ForbiddenException(
        errorBody('Insufficient permissions', API_ERROR_CODES.forbiddenRole),
      );
    }
    return true;
  }
}

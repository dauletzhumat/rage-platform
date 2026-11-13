import { type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { isIP } from 'node:net';
import { SSR_CLIENT_IP_HEADER, SSR_TOKEN_HEADER } from '../../auth/auth.constants.js';
import { safeEqual } from '../../auth/crypto.js';
import { ENV } from '../../config/config.module.js';
import { type Env } from '../../config/env.js';

export const AUTH_THROTTLER = 'auth';

function single(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** IPv6 addresses are bucketed by /64 so one host cannot rotate through its subnet. */
export function normalizeTrackerIp(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) return ip.slice(7);
  const [head = ''] = ip.split('%');
  const parts = head.split('::');
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];
  const full = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return `${full.slice(0, 4).join(':')}::/64`;
}

/**
 * Rate-limit key (AUTH.md §8): the visitor IP forwarded by the web server is used only when
 * the request carries a valid `x-rage-ssr-token` (constant-time compare). Without/with an
 * invalid token both headers are ignored and `req.ip` (TRUST_PROXY_HOPS-aware) is used.
 */
export function resolveThrottleTracker(
  req: { ip?: string; headers: Record<string, unknown> },
  ssrToken: string | undefined,
): string {
  const token = single(req.headers[SSR_TOKEN_HEADER]);
  if (ssrToken && token && safeEqual(token, ssrToken)) {
    const forwarded = single(req.headers[SSR_CLIENT_IP_HEADER])?.trim();
    return forwarded && isIP(forwarded) ? normalizeTrackerIp(forwarded) : 'ssr';
  }
  return normalizeTrackerIp(req.ip ?? 'unknown');
}

@Injectable()
export class RageThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    @Inject(ENV) private readonly env: Env,
  ) {
    super(options, storage, reflector);
  }

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    return Promise.resolve(
      resolveThrottleTracker(
        req as { ip?: string; headers: Record<string, unknown> },
        this.env.INTERNAL_SSR_TOKEN,
      ),
    );
  }
}

const STRICT_AUTH_THROTTLE = 'rage:strict-auth-throttle';

/** Marks a controller (or handler) for the strict `auth` throttler bucket. */
export const StrictAuthThrottle = () => SetMetadata(STRICT_AUTH_THROTTLE, true);

/** The strict `auth` throttler applies only where `@StrictAuthThrottle()` is set. */
export function isStrictAuthRoute(context: ExecutionContext): boolean {
  return (
    Reflect.getMetadata(STRICT_AUTH_THROTTLE, context.getHandler()) === true ||
    Reflect.getMetadata(STRICT_AUTH_THROTTLE, context.getClass()) === true
  );
}

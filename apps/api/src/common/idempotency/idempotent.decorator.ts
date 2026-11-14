import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';

export const IDEMPOTENT_METADATA = 'rage:idempotent';

/**
 * Marks an unsafe handler as accepting an optional `Idempotency-Key` header (TEAMS.md §7).
 * Must be combined with `@Authenticated({ unsafe: true })` / `@RequireRoles(…, { unsafe: true })`
 * (keys are scoped per user). The wiring unit test asserts every M2 unsafe handler carries it.
 */
export function Idempotent() {
  return applyDecorators(
    SetMetadata(IDEMPOTENT_METADATA, true),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: 'Idempotency-Key',
      required: false,
      description:
        'Optional; 16-64 chars [A-Za-z0-9_-] (UUIDs fit), scoped per user, retained 24 h. Same ' +
        'key + same request after completion: stored 2xx response with `Idempotency-Replayed: ' +
        'true`; same key + different request: 409 IDEMPOTENCY_KEY_REUSED; still running: 409 ' +
        'IDEMPOTENCY_IN_PROGRESS with `Retry-After: 1`. Error responses are never stored.',
      schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,64}$', minLength: 16, maxLength: 64 },
    }),
  );
}

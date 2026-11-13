import {
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { catchError, from, mergeMap, type Observable, of, throwError } from 'rxjs';
import type { AuthedRequest } from '../../auth/guards.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { API_ERROR_CODES, errorBody } from '../errors/api-error.js';
import { RequestValidationException } from '../errors/validation.js';
import { canonicalJson } from './canonical-json.js';
import { IDEMPOTENCY_KEY_PATTERN, IdempotencyStore } from './idempotency.store.js';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotency-Replayed';

/** SHA-256 of method + route template + params + canonical JSON body (TEAMS.md §7). */
export function idempotencyRequestHash(
  method: string,
  route: string,
  params: unknown,
  body: unknown,
): string {
  return createHash('sha256')
    .update(`${method}\n${route}\n${canonicalJson(params ?? {})}\n${canonicalJson(body ?? {})}`)
    .digest('hex');
}

/**
 * `Idempotency-Key` support (API_CONVENTIONS §8, TEAMS.md §7). Runs after the guards (session +
 * CSRF already verified, so unauthenticated/forged requests never touch the table) and before
 * pipes/handler, so a request that fails validation releases its reservation like any other
 * error.
 *
 * Design choice: the stored response is written AFTER the business transaction commits, in a
 * separate statement, not inside it. This is acceptable because idempotency is only a
 * convenience layer: every M2 mutation is protected by row locks, in-transaction state checks
 * and DB constraints, so a re-execution (e.g. after a crash left an abandoned reservation that
 * is taken over after IDEMPOTENCY_STALE_SECONDS = 120 s, or after a failed store) can never duplicate an
 * effect — it fails with the contract's 409 (APPLICATION_NOT_PENDING, INVITATION_NOT_PENDING,
 * ALREADY_IN_TEAM, …). Keeping the key out of the business transaction also keeps services free
 * of HTTP concerns.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly store: IdempotencyStore;

  constructor(prisma: PrismaService) {
    this.store = new IdempotencyStore(prisma.client);
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const res = http.getResponse<Response>();
    const raw = req.headers[IDEMPOTENCY_HEADER];
    if (raw === undefined) return next.handle();
    if (typeof raw !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(raw)) {
      throw new RequestValidationException([
        {
          field: 'Idempotency-Key',
          message: 'Idempotency-Key must be 16-64 characters of A-Z, a-z, 0-9, "_" or "-"',
        },
      ]);
    }
    // @Idempotent routes are always behind SessionGuard; without a principal there is no scope.
    if (!req.auth) return next.handle();

    const method = req.method.toUpperCase();
    const routePath: unknown = (req as { route?: { path?: unknown } }).route?.path;
    const route = (typeof routePath === 'string' ? routePath : req.path).slice(0, 200);
    const outcome = await this.store.reserve({
      userId: req.auth.userId,
      key: raw,
      method,
      route,
      requestHash: idempotencyRequestHash(method, route, req.params, req.body),
    });

    switch (outcome.kind) {
      case 'mismatch':
        throw new ConflictException(
          errorBody(
            'Idempotency-Key was already used for a different request',
            API_ERROR_CODES.idempotencyKeyReused,
          ),
        );
      case 'in_progress':
        res.setHeader('Retry-After', '1');
        throw new ConflictException(
          errorBody(
            'A request with this Idempotency-Key is still in progress',
            API_ERROR_CODES.idempotencyInProgress,
          ),
        );
      case 'replay':
        res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
        res.status(outcome.status);
        return of(outcome.body ?? undefined);
      case 'reserved': {
        const { reservationId } = outcome;
        return next.handle().pipe(
          mergeMap(async (body: unknown) => {
            await this.store.complete(reservationId, res.statusCode, body);
            return body;
          }),
          catchError((err: unknown) =>
            from(this.store.release(reservationId)).pipe(mergeMap(() => throwError(() => err))),
          ),
        );
      }
    }
  }
}

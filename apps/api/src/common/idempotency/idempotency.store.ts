import { Logger } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@rage/db';
import { errorSummary } from '../../infra/prisma/prisma.service.js';
import { uuidv7 } from './uuid7.js';

/** TEAMS.md §7: replay window. */
export const IDEMPOTENCY_RETENTION_HOURS = 24;
/**
 * An IN_PROGRESS reservation older than this is considered abandoned (process crash between
 * reserve and complete/release) and may be taken over. A live request is bounded by the
 * business transaction (TX_OPTIONS: maxWait 10 s + timeout 15 s) plus a few short statements,
 * so 120 s leaves a wide margin (gate I-1).
 */
export const IDEMPOTENCY_STALE_SECONDS = 120;
/** Expired rows older than this grace period are purged opportunistically (gate L-4). */
export const IDEMPOTENCY_PURGE_GRACE_SECONDS = 3600;
export const IDEMPOTENCY_PURGE_BATCH = 100;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export interface IdempotencyRequest {
  userId: string;
  key: string;
  method: string;
  route: string;
  requestHash: string;
}

export type ReserveOutcome =
  | { kind: 'reserved'; reservationId: string }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'in_progress' }
  | { kind: 'mismatch' };

/**
 * Persistence for `idempotency_keys` (one row per (user, key)). The reservation is a single
 * atomic `INSERT … ON CONFLICT DO UPDATE … WHERE <expired or abandoned>`: concurrent requests with
 * the same key race on the unique index `idempotency_keys_user_key_uniq`; exactly one of them
 * gets a row back (the reservation), the others load the existing row. Reusing an expired row
 * resets both `created_at` and `expires_at`. A takeover assigns a new `id`, so a late
 * complete/release of an abandoned request (matched by id) is a no-op.
 */
export class IdempotencyStore {
  private readonly logger = new Logger('Idempotency');

  constructor(private readonly db: PrismaClient) {}

  /**
   * Best-effort retention (gate L-4): deletes at most IDEMPOTENCY_PURGE_BATCH rows expired for
   * more than the grace period. SKIP LOCKED keeps concurrent purges from waiting on each other;
   * the `expires_at` index makes this cheap. Failures are logged and ignored.
   */
  async purgeExpired(): Promise<number> {
    try {
      return await this.db.$executeRaw`
        DELETE FROM idempotency_keys WHERE id IN (
          SELECT id FROM idempotency_keys
          WHERE expires_at < now() - make_interval(secs => ${IDEMPOTENCY_PURGE_GRACE_SECONDS}::int)
          ORDER BY expires_at
          LIMIT ${IDEMPOTENCY_PURGE_BATCH}::int
          FOR UPDATE SKIP LOCKED)`;
    } catch (err) {
      this.logger.warn({ err: errorSummary(err) }, 'idempotency purge failed');
      return 0;
    }
  }

  async reserve(req: IdempotencyRequest): Promise<ReserveOutcome> {
    await this.purgeExpired();
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = uuidv7();
      const rows = await this.db.$queryRaw<{ id: string }[]>`
        INSERT INTO idempotency_keys
          (id, user_id, key, method, route, request_hash, status, created_at, expires_at)
        VALUES (${id}::uuid, ${req.userId}::uuid, ${req.key}, ${req.method}, ${req.route},
                ${req.requestHash}, 'IN_PROGRESS', now(),
                now() + make_interval(hours => ${IDEMPOTENCY_RETENTION_HOURS}::int))
        ON CONFLICT (user_id, key) DO UPDATE SET
          id = EXCLUDED.id,
          method = EXCLUDED.method,
          route = EXCLUDED.route,
          request_hash = EXCLUDED.request_hash,
          status = 'IN_PROGRESS',
          response_status = NULL,
          response_body = NULL,
          created_at = EXCLUDED.created_at,
          expires_at = EXCLUDED.expires_at
        WHERE idempotency_keys.expires_at <= now()
           OR (idempotency_keys.status = 'IN_PROGRESS'
               AND idempotency_keys.created_at
                   <= now() - make_interval(secs => ${IDEMPOTENCY_STALE_SECONDS}::int))
        RETURNING id`;
      if (rows[0]) return { kind: 'reserved', reservationId: rows[0].id };

      const existing = await this.db.idempotencyKey.findUnique({
        where: { userId_key: { userId: req.userId, key: req.key } },
        select: {
          method: true,
          route: true,
          requestHash: true,
          status: true,
          responseStatus: true,
          responseBody: true,
        },
      });
      // Released between our INSERT and SELECT (the other request failed): try again.
      if (!existing) continue;
      if (
        existing.method !== req.method ||
        existing.route !== req.route ||
        existing.requestHash !== req.requestHash
      ) {
        return { kind: 'mismatch' };
      }
      if (existing.status === 'IN_PROGRESS' || existing.responseStatus === null) {
        return { kind: 'in_progress' };
      }
      return { kind: 'replay', status: existing.responseStatus, body: existing.responseBody };
    }
    return { kind: 'in_progress' };
  }

  /** Stores a 2xx response. Never throws: on failure the reservation is released instead. */
  async complete(reservationId: string, status: number, body: unknown): Promise<void> {
    if (status < 200 || status > 299) {
      await this.release(reservationId);
      return;
    }
    try {
      const json =
        body === undefined || body === null
          ? Prisma.DbNull
          : (JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue);
      await this.db.idempotencyKey.updateMany({
        where: { id: reservationId, status: 'IN_PROGRESS' },
        data: { status: 'COMPLETED', responseStatus: status, responseBody: json },
      });
    } catch (err) {
      this.logger.error({ err: errorSummary(err) }, 'failed to store idempotent response');
      await this.release(reservationId);
    }
  }

  /** Deletes our IN_PROGRESS reservation (error responses are never stored). Never throws. */
  async release(reservationId: string): Promise<void> {
    try {
      await this.db.idempotencyKey.deleteMany({
        where: { id: reservationId, status: 'IN_PROGRESS' },
      });
    } catch (err) {
      this.logger.error({ err: errorSummary(err) }, 'failed to release idempotency key');
    }
  }
}

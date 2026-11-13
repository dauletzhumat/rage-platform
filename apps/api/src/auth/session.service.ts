import { Inject, Injectable } from '@nestjs/common';
import { type Prisma, type UserStatus } from '@rage/db';
import { ENV } from '../config/config.module.js';
import { type Env } from '../config/env.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { HMAC_PURPOSE_CSRF, LAST_SEEN_WRITE_INTERVAL_MS } from './auth.constants.js';
import { hmacBase64Url, randomToken, sha256Hex, TOKEN_PATTERN } from './crypto.js';

/** Authenticated principal attached to the request by `SessionGuard`. */
export interface AuthContext {
  sessionId: string;
  userId: string;
  steamId64: string;
}

export interface NewSession {
  id: string;
  /** Raw token: goes into the cookie only, never stored or logged. */
  token: string;
  expiresAt: Date;
}

const USER_AGENT_MAX = 512;

/**
 * Opaque server-side sessions (ADR-014): 32-byte random token in an httpOnly cookie,
 * SHA-256 hash in `auth_sessions`, absolute + idle expiry, revocation, user status check.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Creates a session row (use the login transaction client). */
  async create(
    db: Prisma.TransactionClient,
    userId: string,
    userAgent: string | undefined,
    now = new Date(),
  ): Promise<NewSession> {
    const token = randomToken();
    const expiresAt = new Date(now.getTime() + this.env.SESSION_TTL_HOURS * 3600_000);
    const row = await db.authSession.create({
      data: {
        userId,
        tokenHash: sha256Hex(token),
        userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null,
        expiresAt,
        lastSeenAt: now,
        createdAt: now,
      },
      select: { id: true },
    });
    return { id: row.id, token, expiresAt };
  }

  /** Validates a raw cookie token. Returns the principal or `null` (never throws for bad input). */
  async validate(token: string | undefined, now = new Date()): Promise<AuthContext | null> {
    if (!token || !TOKEN_PATTERN.test(token)) return null;
    const row = await this.prisma.client.authSession.findUnique({
      where: { tokenHash: sha256Hex(token) },
      select: {
        id: true,
        expiresAt: true,
        revokedAt: true,
        lastSeenAt: true,
        createdAt: true,
        user: { select: { id: true, steamId64: true, status: true } },
      },
    });
    if (!row || !isSessionUsable(row, row.user.status, now, this.env.SESSION_IDLE_HOURS)) {
      return null;
    }
    const lastSeen = row.lastSeenAt ?? row.createdAt;
    if (now.getTime() - lastSeen.getTime() >= LAST_SEEN_WRITE_INTERVAL_MS) {
      await this.prisma.client.authSession.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { lastSeenAt: now },
      });
    }
    return { sessionId: row.id, userId: row.user.id, steamId64: row.user.steamId64 };
  }

  /** Idempotent. */
  async revoke(sessionId: string, now = new Date()): Promise<boolean> {
    const res = await this.prisma.client.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
    return res.count > 0;
  }

  /** Revokes the session a raw cookie token maps to (rotation on re-login). Idempotent. */
  async revokeByToken(token: string | undefined, now = new Date()): Promise<void> {
    if (!token || !TOKEN_PATTERN.test(token)) return;
    await this.prisma.client.authSession.updateMany({
      where: { tokenHash: sha256Hex(token), revokedAt: null },
      data: { revokedAt: now },
    });
  }

  /** Revokes every active session of a user (suspension/ban). */
  async revokeAllForUser(
    userId: string,
    db: Prisma.TransactionClient | PrismaService['client'] = this.prisma.client,
    now = new Date(),
  ): Promise<number> {
    const res = await db.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return res.count;
  }

  /** Session-bound CSRF token (AUTH.md §5). `null` when no secret is configured. */
  csrfTokenFor(sessionId: string): string | null {
    const secret = this.env.steamAuth?.sessionSecret ?? this.env.SESSION_SECRET;
    if (!secret) return null;
    return hmacBase64Url(secret, HMAC_PURPOSE_CSRF, sessionId);
  }
}

export function isSessionUsable(
  row: { expiresAt: Date; revokedAt: Date | null; lastSeenAt: Date | null; createdAt: Date },
  userStatus: UserStatus,
  now: Date,
  idleHours: number,
): boolean {
  if (row.revokedAt) return false;
  if (row.expiresAt.getTime() <= now.getTime()) return false;
  const lastSeen = row.lastSeenAt ?? row.createdAt;
  if (now.getTime() - lastSeen.getTime() > idleHours * 3600_000) return false;
  return userStatus === 'ACTIVE';
}

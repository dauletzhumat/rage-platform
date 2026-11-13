import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB_CONSTRAINTS, getDbViolation, type Prisma } from '@rage/db';
import { type AuditRequestContext, AuditService } from '../audit/audit.service.js';
import { ENV } from '../config/config.module.js';
import { type Env } from '../config/env.js';
import { errorSummary, PrismaService } from '../infra/prisma/prisma.service.js';
import { LoginError, type LoginErrorCode } from './auth.constants.js';
import { defaultNickname, playerSlugCandidates } from './profile-rules.js';
import { type NewSession, SessionService } from './session.service.js';
import { SteamProfileSyncService } from './steam-profile-sync.js';

export interface LoginResult {
  userId: string;
  session: NewSession;
  newUser: boolean;
}

const MAX_ATTEMPTS = 4;
export const BOOTSTRAP_REASON = 'bootstrap:env';

/** Unique violations that are expected under concurrency and resolved by retrying. */
const RETRYABLE_UNIQUE = new Set<string | undefined>([
  DB_CONSTRAINTS.userSteamIdUnique,
  DB_CONSTRAINTS.playerProfileSlugUnique,
  DB_CONSTRAINTS.roleGrantActiveUnique,
  'player_profiles_user_id_key',
  'steam_profiles_user_id_key',
  undefined,
]);

/**
 * Login transaction (AUTH.md §3 step 3): exactly one user per verified SteamID64, profile on
 * first login, new session, optional bootstrap SUPER_ADMIN, audit — all atomic. Concurrent
 * first logins of the same SteamID race on the unique index; the loser retries and reuses
 * the winner's user.
 */
@Injectable()
export class LoginService {
  private readonly logger = new Logger(LoginService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly profileSync: SteamProfileSyncService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(
    steamId64: string,
    userAgent: string | undefined,
    ctx: AuditRequestContext,
  ): Promise<LoginResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.prisma.client.$transaction((tx) =>
          this.loginTx(tx, steamId64, userAgent, ctx),
        );
        if (this.profileSync.enabled) {
          // Best effort, after commit; never delays or fails the login.
          void this.profileSync.sync(result.userId, steamId64, result.newUser);
        }
        return result;
      } catch (err) {
        if (err instanceof LoginError) {
          await this.recordRejection(err.code, steamId64, ctx);
          err.audited = true;
          throw err;
        }
        const violation = getDbViolation(err);
        if (violation?.kind === 'unique' && RETRYABLE_UNIQUE.has(violation.constraint)) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    this.logger.error({ err: errorSummary(lastError) }, 'login transaction retries exhausted');
    throw lastError;
  }

  /**
   * Record a rejected login. Only rejections for a Steam-VERIFIED SteamID (after
   * `check_authentication`) go to the append-only audit log; earlier failures (state mismatch,
   * replay, cancel, invalid assertion) are reachable anonymously and are only logged, so they
   * cannot flood `audit_logs` (security gate M1, finding L-3). Never throws.
   */
  async recordRejection(
    code: LoginErrorCode,
    verifiedSteamId64: string | undefined,
    ctx: AuditRequestContext,
  ): Promise<void> {
    if (!verifiedSteamId64) {
      this.logger.log({ code, requestId: ctx.serverRequestId }, 'steam login rejected');
      return;
    }
    try {
      await this.audit.write(
        {
          action: 'auth.login_rejected',
          actorUserId: null,
          resourceType: 'auth',
          resourceId: null,
          detail: { code, ...(verifiedSteamId64 ? { steamId64: verifiedSteamId64 } : {}) },
        },
        ctx,
      );
    } catch (err) {
      this.logger.warn({ err: errorSummary(err) }, 'failed to audit login rejection');
    }
  }

  private async loginTx(
    tx: Prisma.TransactionClient,
    steamId64: string,
    userAgent: string | undefined,
    ctx: AuditRequestContext,
  ): Promise<LoginResult> {
    const now = new Date();
    let user = await tx.user.findUnique({
      where: { steamId64 },
      select: { id: true, status: true, isSample: true, playerProfile: { select: { id: true } } },
    });
    let newUser = false;
    if (!user) {
      user = await tx.user.create({
        data: { steamId64, status: 'ACTIVE', isSample: false },
        select: { id: true, status: true, isSample: true, playerProfile: { select: { id: true } } },
      });
      newUser = true;
    }
    if (user.isSample) throw new LoginError('unsupported_account', steamId64);
    if (user.status !== 'ACTIVE') throw new LoginError('account_suspended', steamId64);

    if (!user.playerProfile) {
      await tx.playerProfile.create({
        data: {
          userId: user.id,
          nickname: defaultNickname(steamId64),
          slug: await this.freeSlug(tx, steamId64),
        },
      });
    }

    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
    const session = await this.sessions.create(tx, user.id, userAgent, now);

    if (this.env.BOOTSTRAP_SUPER_ADMIN_STEAM_ID64 === steamId64) {
      await this.applyBootstrapGrant(tx, user.id, ctx);
    }

    await this.audit.write(
      {
        action: 'auth.login',
        actorUserId: user.id,
        resourceType: 'user',
        resourceId: user.id,
        detail: { sessionId: session.id, newUser },
      },
      ctx,
      tx,
    );
    return { userId: user.id, session, newUser };
  }

  private async freeSlug(tx: Prisma.TransactionClient, steamId64: string): Promise<string> {
    const candidates = playerSlugCandidates(steamId64);
    const taken = await tx.playerProfile.findMany({
      where: { slug: { in: candidates } },
      select: { slug: true },
    });
    const takenSet = new Set(taken.map((t) => t.slug));
    const free = candidates.find((c) => !takenSet.has(c));
    // All candidates taken is practically impossible (random suffixes); if it happens, the
    // insert fails with a unique violation and the transaction is retried with new suffixes.
    return free ?? (candidates.at(-1) as string);
  }

  private async applyBootstrapGrant(
    tx: Prisma.TransactionClient,
    userId: string,
    ctx: AuditRequestContext,
  ): Promise<void> {
    // One-shot (ADR-017): any prior global SUPER_ADMIN grant — active OR revoked — means the
    // bootstrap already happened or an admin decided otherwise. A revocation must stick even
    // while the env var is still set (security gate M1, finding M-1).
    const existing = await tx.userRoleGrant.findFirst({
      where: { userId, role: 'SUPER_ADMIN', scopeType: 'GLOBAL' },
      select: { id: true },
    });
    if (existing) return;
    const grant = await tx.userRoleGrant.create({
      data: {
        userId,
        role: 'SUPER_ADMIN',
        scopeType: 'GLOBAL',
        scopeId: null,
        issuedById: null,
        reason: BOOTSTRAP_REASON,
      },
      select: { id: true },
    });
    await this.audit.write(
      {
        action: 'role_grant.bootstrap',
        actorUserId: null,
        resourceType: 'user_role_grant',
        resourceId: grant.id,
        detail: { targetUserId: userId, role: 'SUPER_ADMIN', scopeType: 'GLOBAL' },
      },
      ctx,
      tx,
    );
  }
}

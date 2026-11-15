import { Injectable } from '@nestjs/common';
import { type Prisma } from '@rage/db';
import { type AuditRequestContext, AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { type Page, pageOf, toSkipTake } from '../common/pagination/pagination.js';
import { fieldError, forbiddenRole } from '../team-domain/team-errors.js';
import { hasSuperAdminLocked } from '../team-domain/team-access.js';
import { advanceWinner } from '../tournament-domain/advancement.js';
import { SamplePolicy, sampleAuditTag } from '../tournament-domain/sample-policy.js';
import { conflictOfInterest, operatedTeamIds } from '../tournament-domain/conflict-of-interest.js';
import { validateSeriesScore } from '../tournament-domain/series-score.js';
import {
  isMatchAdminLocked,
  type LockedTournament,
  lockTournament,
  M3_TX_OPTIONS,
} from '../tournament-domain/tournament-access.js';
import {
  matchAlreadyCompleted,
  matchNotFound,
  matchNotReady,
  scoreInvalid,
} from '../tournament-domain/tournament-errors.js';
import {
  matchDetailSelect,
  matchSummarySelect,
  toMatchDetail,
  toMatchSummary,
} from './match-view.js';
import type {
  AdminMatchesQueryDto,
  ForfeitDto,
  MatchDetailDto,
  MatchSummaryDto,
  ResultOverrideDto,
} from './matches.dto.js';
import { type LockedMatch, lockMatch, transitionMatch } from './transitions.js';

type Tx = Prisma.TransactionClient;

interface Prepared {
  tournament: LockedTournament | null;
  match: LockedMatch & { teamAId: string; teamBId: string };
  /** SUPER_ADMIN acting despite operating a team of the match (L-3 b; audited). */
  conflictOverride: boolean;
}

/**
 * Admin results (docs/TOURNAMENTS.md §9; M3 only). Never server-verified: `result_source` is
 * ADMIN_OVERRIDE / FORFEIT and `result_verified_at` stays NULL (DB CHECK). Lock order:
 * tournament (FOR UPDATE) → grants → match → next match, so double overrides, override vs
 * forfeit and semifinals completing into the same final all serialize on the tournament row.
 */
@Injectable()
export class MatchResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly samples: SamplePolicy,
  ) {}

  private async prepare(tx: Tx, actorUserId: string, matchId: string): Promise<Prepared> {
    const ref = await tx.match.findUnique({
      where: { id: matchId },
      select: { tournamentId: true, isSample: true },
    });
    if (!ref) throw matchNotFound();
    let tournament: LockedTournament | null = null;
    if (ref.tournamentId) {
      tournament = await lockTournament(tx, ref.tournamentId, 'update', this.samples);
    }
    this.samples.assertMatchMutable(ref, tournament);
    if (!(await isMatchAdminLocked(tx, actorUserId, matchId, ref.tournamentId))) {
      if (tournament?.status === 'DRAFT') throw matchNotFound();
      throw forbiddenRole();
    }
    const match = await lockMatch(tx, matchId);
    if (!match) throw matchNotFound();
    if (match.status === 'COMPLETED') throw matchAlreadyCompleted();
    if (match.status !== 'CREATED' || !match.teamAId || !match.teamBId) {
      throw matchNotReady('The match needs both teams and must not have started or ended');
    }
    if (tournament && tournament.status !== 'IN_PROGRESS') {
      throw matchNotReady('The tournament is not in progress');
    }
    // L-3 (b): an official running either team must not decide the result.
    const operated = await operatedTeamIds(tx, actorUserId, [match.teamAId, match.teamBId]);
    let conflictOverride = false;
    if (operated.size > 0) {
      if (!(await hasSuperAdminLocked(tx, actorUserId))) {
        throw conflictOfInterest('You operate a team of this match');
      }
      conflictOverride = true;
    }
    return { tournament, match: match as Prepared['match'], conflictOverride };
  }

  private async complete(
    tx: Tx,
    ctx: AuditRequestContext,
    p: Prepared,
    actorUserId: string,
    result: {
      winnerTeamId: string;
      teamAScore: number | null;
      teamBScore: number | null;
      source: 'ADMIN_OVERRIDE' | 'FORFEIT';
      reason: string;
      forfeitingTeamId?: string;
    },
  ): Promise<void> {
    const now = new Date();
    const loserTeamId = result.winnerTeamId === p.match.teamAId ? p.match.teamBId : p.match.teamAId;
    // COMPLETED, result_source and winner in ONE update (matches_completed_result_chk).
    await transitionMatch(tx, p.match, 'COMPLETED', {
      source: 'ADMIN',
      actorUserId,
      reason: result.reason,
      now,
      data: {
        winnerTeamId: result.winnerTeamId,
        teamAScore: result.teamAScore,
        teamBScore: result.teamBScore,
        resultSource: result.source,
        resultVerifiedAt: null,
        completedAt: now,
      },
    });
    await this.audit.write(
      {
        action: result.source === 'FORFEIT' ? 'match.forfeit' : 'match.result_override',
        actorUserId,
        resourceType: 'match',
        resourceId: p.match.id,
        detail: {
          tournamentId: p.match.tournamentId,
          winnerTeamId: result.winnerTeamId,
          loserTeamId,
          teamAScore: result.teamAScore,
          teamBScore: result.teamBScore,
          resultSource: result.source,
          reason: result.reason,
          ...(result.forfeitingTeamId ? { forfeitingTeamId: result.forfeitingTeamId } : {}),
          ...(p.conflictOverride ? { override: true, conflictOfInterest: true } : {}),
          ...sampleAuditTag(p.tournament?.isSample === true),
        },
      },
      ctx,
      tx,
    );
    if (p.tournament) {
      await advanceWinner(tx, this.audit, ctx, {
        tournamentId: p.tournament.id,
        tournamentStatus: p.tournament.status,
        match: p.match,
        winnerTeamId: result.winnerTeamId,
        loserTeamId,
        actorUserId,
        now,
        sample: p.tournament.isSample,
      });
    }
  }

  async override(
    actorUserId: string,
    matchId: string,
    dto: ResultOverrideDto,
    ctx: AuditRequestContext,
  ): Promise<MatchDetailDto> {
    await this.prisma.client.$transaction(async (tx) => {
      const p = await this.prepare(tx, actorUserId, matchId);
      const side =
        dto.winnerTeamId === p.match.teamAId
          ? 'A'
          : dto.winnerTeamId === p.match.teamBId
            ? 'B'
            : null;
      if (!side) throw fieldError('winnerTeamId', 'winnerTeamId must be team A or team B');
      const problem = validateSeriesScore(p.match.format, dto.teamAScore, dto.teamBScore, side);
      if (problem) throw scoreInvalid(problem);
      await this.complete(tx, ctx, p, actorUserId, {
        winnerTeamId: dto.winnerTeamId,
        teamAScore: dto.teamAScore,
        teamBScore: dto.teamBScore,
        source: 'ADMIN_OVERRIDE',
        reason: dto.reason,
      });
    }, M3_TX_OPTIONS);
    return this.load(matchId);
  }

  async forfeit(
    actorUserId: string,
    matchId: string,
    dto: ForfeitDto,
    ctx: AuditRequestContext,
  ): Promise<MatchDetailDto> {
    await this.prisma.client.$transaction(async (tx) => {
      const p = await this.prepare(tx, actorUserId, matchId);
      let winnerTeamId: string;
      if (dto.forfeitingTeamId === p.match.teamAId) winnerTeamId = p.match.teamBId;
      else if (dto.forfeitingTeamId === p.match.teamBId) winnerTeamId = p.match.teamAId;
      else throw fieldError('forfeitingTeamId', 'forfeitingTeamId must be team A or team B');
      await this.complete(tx, ctx, p, actorUserId, {
        winnerTeamId,
        teamAScore: null,
        teamBScore: null,
        source: 'FORFEIT',
        reason: dto.reason,
        forfeitingTeamId: dto.forfeitingTeamId,
      });
    }, M3_TX_OPTIONS);
    return this.load(matchId);
  }

  /**
   * Admin match list (§15.10): SUPER_ADMIN, GLOBAL TOURNAMENT_ADMIN / MATCH_ADMIN see all
   * matches; TOURNAMENT-scoped admins see their tournaments; MATCH-scoped MATCH_ADMIN their
   * matches. No authority at all → 403.
   */
  async listForAdmin(
    actorUserId: string,
    query: AdminMatchesQueryDto,
  ): Promise<Page<MatchSummaryDto>> {
    const db = this.prisma.client;
    const grants = await db.userRoleGrant.findMany({
      where: {
        userId: actorUserId,
        revokedAt: null,
        role: { in: ['SUPER_ADMIN', 'TOURNAMENT_ADMIN', 'MATCH_ADMIN'] },
      },
      select: { scopeType: true, scopeId: true },
    });
    if (grants.length === 0) throw forbiddenRole();
    const all = grants.some((g) => g.scopeType === 'GLOBAL');
    const tournamentIds = grants
      .filter((g) => g.scopeType === 'TOURNAMENT' && g.scopeId)
      .map((g) => g.scopeId!);
    const matchIds = grants
      .filter((g) => g.scopeType === 'MATCH' && g.scopeId)
      .map((g) => g.scopeId!);
    const where: Prisma.MatchWhereInput = {
      AND: [
        all ? {} : { OR: [{ tournamentId: { in: tournamentIds } }, { id: { in: matchIds } }] },
        query.tournamentId ? { tournamentId: query.tournamentId } : {},
        query.status ? { status: query.status } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      db.match.findMany({
        where,
        select: matchSummarySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      db.match.count({ where }),
    ]);
    return pageOf(rows.map(toMatchSummary), total, query);
  }

  private async load(matchId: string): Promise<MatchDetailDto> {
    const row = await this.prisma.client.match.findUniqueOrThrow({
      where: { id: matchId },
      select: matchDetailSelect,
    });
    return toMatchDetail(row);
  }
}

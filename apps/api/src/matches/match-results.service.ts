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
import { deriveSeriesFromMaps, validateSeriesScore } from '../tournament-domain/series-score.js';
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

type MapOutcome =
  | {
      id: string;
      mapOrder: number;
      mapName: string;
      teamAScore: number;
      teamBScore: number;
      winnerTeamId: string;
    }
  | { id: string; mapOrder: number; mapName: string; played: false };

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

  /**
   * Per-map admin result: needs the veto's match maps (else 409 MATCH_NOT_READY); the series
   * score and winner are DERIVED from the map scores; series fields sent alongside must match
   * (else 400 SCORE_INVALID).
   */
  private async mapResult(tx: Tx, p: Prepared, dto: ResultOverrideDto) {
    const rows = await tx.matchMap.findMany({
      where: { matchId: p.match.id },
      orderBy: { mapOrder: 'asc' },
      select: { id: true, mapOrder: true, mapName: true, status: true },
    });
    if (rows.length === 0) {
      throw matchNotReady('Map scores can be entered only after the map veto is complete');
    }
    const inputs = dto.maps!;
    if (inputs.length > rows.length) {
      throw scoreInvalid(`this match has only ${rows.length} map(s)`);
    }
    const derived = deriveSeriesFromMaps(p.match.format, inputs);
    if (typeof derived === 'string') throw scoreInvalid(derived);
    const winnerTeamId = derived.winner === 'A' ? p.match.teamAId : p.match.teamBId;
    if (dto.winnerTeamId !== undefined && dto.winnerTeamId !== winnerTeamId) {
      throw scoreInvalid('winnerTeamId does not match the map scores');
    }
    if (
      (dto.teamAScore !== undefined && dto.teamAScore !== derived.teamAScore) ||
      (dto.teamBScore !== undefined && dto.teamBScore !== derived.teamBScore)
    ) {
      throw scoreInvalid('series score does not match the map scores');
    }
    return {
      winnerTeamId,
      teamAScore: derived.teamAScore,
      teamBScore: derived.teamBScore,
      maps: rows.map((row, i) => {
        const input = inputs[i];
        return input
          ? {
              id: row.id,
              mapOrder: row.mapOrder,
              mapName: row.mapName,
              teamAScore: input.teamAScore,
              teamBScore: input.teamBScore,
              winnerTeamId: derived.mapWinners[i] === 'A' ? p.match.teamAId : p.match.teamBId,
            }
          : { id: row.id, mapOrder: row.mapOrder, mapName: row.mapName, played: false as const };
      }),
    };
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
      maps?: MapOutcome[];
    },
  ): Promise<void> {
    const now = new Date();
    // Map rows first (the hardening trigger freezes only the `matches` result columns once
    // COMPLETED; match_maps are written in the same transaction, before the series completes).
    for (const m of result.maps ?? []) {
      const updated = await tx.matchMap.updateMany({
        where: { id: m.id, matchId: p.match.id, status: 'PENDING' },
        data:
          'played' in m
            ? { status: 'CANCELLED' }
            : {
                status: 'FINISHED',
                teamAScore: m.teamAScore,
                teamBScore: m.teamBScore,
                winnerTeamId: m.winnerTeamId,
                completedAt: now,
              },
      });
      if (updated.count !== 1) throw matchNotReady(`Map ${m.mapOrder} is no longer pending`);
    }
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
          ...(result.maps
            ? {
                maps: result.maps.map((m) =>
                  'played' in m
                    ? { mapOrder: m.mapOrder, mapName: m.mapName, status: 'CANCELLED' }
                    : {
                        mapOrder: m.mapOrder,
                        mapName: m.mapName,
                        status: 'FINISHED',
                        teamAScore: m.teamAScore,
                        teamBScore: m.teamBScore,
                        winnerTeamId: m.winnerTeamId,
                      },
                ),
              }
            : {}),
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
      if (dto.maps) {
        const mapResult = await this.mapResult(tx, p, dto);
        await this.complete(tx, ctx, p, actorUserId, {
          winnerTeamId: mapResult.winnerTeamId,
          teamAScore: mapResult.teamAScore,
          teamBScore: mapResult.teamBScore,
          source: 'ADMIN_OVERRIDE',
          reason: dto.reason,
          maps: mapResult.maps,
        });
        return;
      }
      const side =
        dto.winnerTeamId === p.match.teamAId
          ? 'A'
          : dto.winnerTeamId === p.match.teamBId
            ? 'B'
            : null;
      if (!side) throw fieldError('winnerTeamId', 'winnerTeamId must be team A or team B');
      const a = dto.teamAScore!;
      const b = dto.teamBScore!;
      const problem = validateSeriesScore(p.match.format, a, b, side);
      if (problem) throw scoreInvalid(problem);
      await this.complete(tx, ctx, p, actorUserId, {
        winnerTeamId: dto.winnerTeamId!,
        teamAScore: a,
        teamBScore: b,
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

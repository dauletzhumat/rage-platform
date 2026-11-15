import { Injectable } from '@nestjs/common';
import { DB_CONSTRAINTS, type Prisma } from '@rage/db';
import { type AuditRequestContext, AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { resolveTeamAccess } from '../team-domain/team-access.js';
import { forbiddenRole, rethrowMapped, sampleResource } from '../team-domain/team-errors.js';
import { conflictOfInterest, operatedTeamIds } from '../tournament-domain/conflict-of-interest.js';
import { lockTournament, M3_TX_OPTIONS } from '../tournament-domain/tournament-access.js';
import {
  matchNotFound,
  matchNotReady,
  vetoComplete,
  vetoInvalidMap,
  vetoNotYourTurn,
} from '../tournament-domain/tournament-errors.js';
import { MAP_POOL_SIZE, readSettings } from '../tournament-domain/tournament-policy.js';
import { computeVeto, playedMapOrder, type VetoRecord } from '../tournament-domain/veto.js';
import { publicMatchWhere } from './match-view.js';
import type { SubmitVetoDto, VetoStateDto } from './matches.dto.js';
import { lockMatch } from './transitions.js';

interface VetoRow {
  sequence: number;
  action: 'BAN' | 'PICK' | 'DECIDER' | 'SIDE_PICK';
  mapName: string;
  actorTeamId: string | null;
  createdAt: Date;
}

const vetoRowSelect = {
  sequence: true,
  action: true,
  mapName: true,
  actorTeamId: true,
  createdAt: true,
} satisfies Prisma.MapVetoActionSelect;

function records(rows: readonly VetoRow[]): VetoRecord[] {
  return rows
    .filter((r) => r.action !== 'SIDE_PICK')
    .map((r) => ({
      sequence: r.sequence,
      action: r.action as VetoRecord['action'],
      mapName: r.mapName,
    }));
}

function buildState(
  format: 'BO1' | 'BO3' | 'BO5',
  pool: string[],
  rows: readonly VetoRow[],
  teams: { teamAId: string | null; teamBId: string | null },
  /** Whether a veto action could be accepted right now (same rules as `submit`). */
  open = true,
): VetoStateDto {
  const state = computeVeto(format, pool, records(rows));
  const nextTeam =
    open && state.next ? (state.next.side === 'A' ? teams.teamAId : teams.teamBId) : null;
  return {
    pool,
    actions: [...rows]
      .filter((r) => r.action !== 'SIDE_PICK')
      .sort((a, b) => a.sequence - b.sequence)
      .map((r) => ({
        sequence: r.sequence,
        teamId: r.actorTeamId,
        action: r.action as VetoStateDto['actions'][number]['action'],
        mapName: r.mapName,
        createdAt: r.createdAt.toISOString(),
      })),
    next: state.next && nextTeam ? { teamId: nextTeam, action: state.next.action } : null,
    remaining: state.remaining,
    complete: state.complete,
  };
}

/**
 * Map veto (docs/TOURNAMENTS.md §8). Lock order: tournament (FOR SHARE) → match (FOR UPDATE) →
 * acting team (FOR SHARE) → grants. The match row lock serializes concurrent submissions; the
 * unique `(match_id, sequence)` and map-once indexes are the backstop.
 */
@Injectable()
export class VetoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getState(matchId: string): Promise<VetoStateDto> {
    const match = await this.prisma.client.match.findFirst({
      where: { AND: [publicMatchWhere, { id: matchId }] },
      select: {
        format: true,
        status: true,
        teamAId: true,
        teamBId: true,
        tournament: { select: { settingsJson: true, status: true } },
        vetoActions: { select: vetoRowSelect },
      },
    });
    if (!match) throw matchNotFound();
    const pool = readSettings(match.tournament?.settingsJson).mapPool;
    // Announce a turn only when `submit` would accept it (QA/web feedback): running tournament,
    // CREATED match, both teams known, full map pool.
    const open =
      match.tournament?.status === 'IN_PROGRESS' &&
      match.status === 'CREATED' &&
      !!match.teamAId &&
      !!match.teamBId &&
      pool.length === MAP_POOL_SIZE;
    return buildState(match.format, pool, match.vetoActions, match, open);
  }

  async submit(
    actorUserId: string,
    matchId: string,
    dto: SubmitVetoDto,
    ctx: AuditRequestContext,
  ): Promise<VetoStateDto> {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const ref = await tx.match.findUnique({
          where: { id: matchId },
          select: { tournamentId: true, isSample: true },
        });
        if (!ref) throw matchNotFound();
        if (ref.isSample) throw sampleResource();
        if (!ref.tournamentId) throw matchNotReady('Veto is only available for tournament matches');
        const tournament = await lockTournament(tx, ref.tournamentId, 'share');
        if (tournament.status === 'DRAFT') throw matchNotFound();
        const match = await lockMatch(tx, matchId);
        if (!match) throw matchNotFound();
        if (
          tournament.status !== 'IN_PROGRESS' ||
          match.status !== 'CREATED' ||
          !match.teamAId ||
          !match.teamBId
        ) {
          throw matchNotReady('Veto needs a CREATED match with both teams in a running tournament');
        }
        const pool = readSettings(tournament.settingsJson).mapPool;
        if (pool.length !== MAP_POOL_SIZE) throw matchNotReady('Tournament map pool is not set');
        const rows = await tx.mapVetoAction.findMany({
          where: { matchId },
          select: vetoRowSelect,
        });
        const state = computeVeto(match.format, pool, records(rows));
        if (state.complete || !state.next) throw vetoComplete();
        const turnTeamId = state.next.side === 'A' ? match.teamAId : match.teamBId;
        const otherTeamId = state.next.side === 'A' ? match.teamBId : match.teamAId;

        await tx.$queryRaw`SELECT id FROM teams WHERE id = ${turnTeamId}::uuid FOR SHARE`;
        const access = await resolveTeamAccess(tx, turnTeamId, actorUserId);
        if (!access.isOperator) {
          const other = await resolveTeamAccess(tx, otherTeamId, actorUserId);
          if (other.isOperator) throw vetoNotYourTurn();
          throw forbiddenRole();
        }
        // L-3 (a): someone running BOTH teams must not veto for either (SUPER_ADMIN: audited).
        const operated = await operatedTeamIds(tx, actorUserId, [match.teamAId, match.teamBId]);
        let conflictOverride = false;
        if (operated.size === 2) {
          if (!access.isSuperAdmin) {
            throw conflictOfInterest('You operate both teams of this match');
          }
          conflictOverride = true;
        }
        if (dto.action !== state.next.action) throw vetoNotYourTurn();
        if (!state.remaining.includes(dto.mapName)) throw vetoInvalidMap();

        const now = new Date();
        await tx.mapVetoAction.create({
          data: {
            matchId,
            sequence: state.next.sequence,
            actorTeamId: turnTeamId,
            actorUserId,
            action: dto.action,
            mapName: dto.mapName,
            createdAt: now,
          },
        });
        const after = await tx.mapVetoAction.findMany({
          where: { matchId },
          select: vetoRowSelect,
        });
        const afterState = computeVeto(match.format, pool, records(after));
        let decider: string | null = null;
        if (afterState.deciderPending) {
          if (afterState.remaining.length !== 1) {
            throw new Error(`veto ended with ${afterState.remaining.length} maps remaining`);
          }
          decider = afterState.remaining[0]!;
          await tx.mapVetoAction.create({
            data: {
              matchId,
              sequence: state.next.sequence + 1,
              actorTeamId: null,
              actorUserId: null,
              action: 'DECIDER',
              mapName: decider,
              createdAt: now,
            },
          });
          const all = await tx.mapVetoAction.findMany({
            where: { matchId },
            select: vetoRowSelect,
          });
          const order = playedMapOrder(records(all));
          await tx.matchMap.createMany({
            data: order.map((mapName, i) => ({
              matchId,
              mapOrder: i + 1,
              mapName,
              status: 'PENDING' as const,
              createdAt: now,
            })),
          });
        }
        await this.audit.write(
          {
            action: 'match.veto',
            actorUserId,
            resourceType: 'match',
            resourceId: matchId,
            detail: {
              tournamentId: tournament.id,
              teamId: turnTeamId,
              sequence: state.next.sequence,
              action: dto.action,
              mapName: dto.mapName,
              ...(decider ? { decider, complete: true } : {}),
              ...(access.override || conflictOverride ? { override: true } : {}),
              ...(conflictOverride ? { conflictOfInterest: true } : {}),
            },
          },
          ctx,
          tx,
        );
        const final = await tx.mapVetoAction.findMany({
          where: { matchId },
          select: vetoRowSelect,
        });
        return buildState(match.format, pool, final, match);
      }, M3_TX_OPTIONS);
    } catch (err) {
      rethrowMapped(err, {
        [DB_CONSTRAINTS.vetoSequenceUnique]: vetoNotYourTurn,
        [DB_CONSTRAINTS.vetoMapOncePerMatch]: vetoInvalidMap,
        [DB_CONSTRAINTS.matchMapNameUnique]: vetoComplete,
      });
    }
  }
}

import { Injectable } from '@nestjs/common';
import { type Prisma } from '@rage/db';
import { type AuditRequestContext, AuditService } from '../audit/audit.service.js';
import { API_ERROR_CODES } from '../common/errors/api-error.js';
import { iso } from '../common/http/dto.js';
import { type Page, pageOf, toSkipTake } from '../common/pagination/pagination.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { lockTeam } from '../team-domain/team-access.js';
import { conflict, forbiddenRole, sampleResource } from '../team-domain/team-errors.js';
import { evaluateEligibility, type RosterEntryInput } from '../tournament-domain/eligibility.js';
import {
  registrationSelect,
  type RegistrationRow,
  toRegistrationDto,
} from '../tournament-domain/registration-view.js';
import {
  currentRoster,
  lockRegistration,
  writeRosterVersion,
} from '../tournament-domain/rosters.js';
import {
  lockTournament,
  M3_TX_OPTIONS,
  requireTournamentAdmin,
  tournamentAdminScope,
} from '../tournament-domain/tournament-access.js';
import {
  invalidStateTransition,
  playerIneligible,
  registrationNotPending,
  rosterInvalid,
  substitutionNotAllowed,
  tournamentFull,
  tournamentNotFound,
} from '../tournament-domain/tournament-errors.js';
import { MAX_TEAMS_MAX, rosterShapeProblems } from '../tournament-domain/tournament-policy.js';
import type {
  AdminRegistrationDto,
  AdminRegistrationsQueryDto,
  SubstituteRegistrationDto,
} from './tournament-admin.dto.js';

type Tx = Prisma.TransactionClient;

const APPROVABLE_TOURNAMENT_STATUSES = new Set(['REGISTRATION_OPEN', 'REGISTRATION_CLOSED']);
const SUBSTITUTION_TOURNAMENT_STATUSES = new Set([
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
]);

export function toAdminRegistrationDto(row: RegistrationRow): AdminRegistrationDto {
  return {
    ...toRegistrationDto(row),
    isSample: row.team.isSample || row.tournament.isSample,
    reviewedAt: iso(row.reviewedAt),
  };
}

/**
 * Registration review by tournament admins (docs/TOURNAMENTS.md §4). Lock order: tournament
 * (FOR UPDATE) → registration → team → grants → users. The tournament lock serializes every
 * approval, so the approved count can never exceed `maxTeams`.
 */
@Injectable()
export class RegistrationReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actorUserId: string,
    tournamentId: string,
    query: AdminRegistrationsQueryDto,
  ): Promise<Page<AdminRegistrationDto>> {
    const db = this.prisma.client;
    const t = await db.tournament.findUnique({
      where: { id: tournamentId },
      select: { status: true },
    });
    if (!t) throw tournamentNotFound();
    const scope = await tournamentAdminScope(db, actorUserId);
    if (!scope.all && !scope.tournamentIds.includes(tournamentId)) {
      if (t.status === 'DRAFT') throw tournamentNotFound();
      throw forbiddenRole();
    }
    const where: Prisma.TournamentRegistrationWhereInput = {
      tournamentId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await db.$transaction([
      db.tournamentRegistration.findMany({
        where,
        select: registrationSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      db.tournamentRegistration.count({ where }),
    ]);
    return pageOf(rows.map(toAdminRegistrationDto), total, query);
  }

  async approve(
    actorUserId: string,
    tournamentId: string,
    registrationId: string,
    note: string | null | undefined,
    ctx: AuditRequestContext,
  ): Promise<AdminRegistrationDto> {
    await this.prisma.client.$transaction(async (tx) => {
      const t = await lockTournament(tx, tournamentId, 'update');
      const reg = await lockRegistration(tx, tournamentId, registrationId);
      await requireTournamentAdmin(tx, actorUserId, t);
      await this.assertTeamUsable(tx, reg.teamId);
      if (reg.status !== 'PENDING') throw registrationNotPending();
      if (!APPROVABLE_TOURNAMENT_STATUSES.has(t.status)) {
        throw invalidStateTransition(`Registrations cannot be approved while ${t.status}`);
      }
      const approved = await tx.tournamentRegistration.count({
        where: { tournamentId, status: 'APPROVED' },
      });
      if (approved >= (t.maxTeams ?? MAX_TEAMS_MAX)) throw tournamentFull();
      const roster = await currentRoster(tx, registrationId);
      if (!roster || roster.status !== 'DRAFT') {
        throw new Error(`registration ${registrationId} has no DRAFT roster`);
      }
      // Re-validate the snapshot (membership NOT re-checked: the snapshot is what counts).
      const { problems } = await evaluateEligibility(tx, {
        tournamentId,
        teamId: reg.teamId,
        userIds: roster.entries.map((e) => e.userId),
        checkMembership: false,
      });
      if (problems.length > 0) throw playerIneligible(problems);
      const now = new Date();
      await tx.tournamentRoster.update({
        where: { id: roster.id },
        data: { status: 'LOCKED', lockedAt: now, lockedById: actorUserId },
      });
      await tx.tournamentRegistration.update({
        where: { id: registrationId },
        data: {
          status: 'APPROVED',
          reviewedById: actorUserId,
          reviewedAt: now,
          reviewReason: note ?? null,
        },
      });
      await this.audit.write(
        {
          action: 'registration.approve',
          actorUserId,
          resourceType: 'tournament_registration',
          resourceId: registrationId,
          detail: {
            tournamentId,
            teamId: reg.teamId,
            rosterId: roster.id,
            rosterVersion: roster.version,
            approvedCount: approved + 1,
            maxTeams: t.maxTeams,
            note: note ?? null,
          },
        },
        ctx,
        tx,
      );
    }, M3_TX_OPTIONS);
    return this.load(registrationId);
  }

  async reject(
    actorUserId: string,
    tournamentId: string,
    registrationId: string,
    reason: string,
    ctx: AuditRequestContext,
  ): Promise<AdminRegistrationDto> {
    await this.prisma.client.$transaction(async (tx) => {
      const t = await lockTournament(tx, tournamentId, 'update');
      const reg = await lockRegistration(tx, tournamentId, registrationId);
      await requireTournamentAdmin(tx, actorUserId, t);
      await this.assertTeamUsable(tx, reg.teamId, { requireActive: false });
      if (reg.status !== 'PENDING') throw registrationNotPending();
      await tx.tournamentRegistration.update({
        where: { id: registrationId },
        data: {
          status: 'REJECTED',
          reviewedById: actorUserId,
          reviewedAt: new Date(),
          reviewReason: reason,
        },
      });
      await this.audit.write(
        {
          action: 'registration.reject',
          actorUserId,
          resourceType: 'tournament_registration',
          resourceId: registrationId,
          detail: { tournamentId, teamId: reg.teamId, reason },
        },
        ctx,
        tx,
      );
    }, M3_TX_OPTIONS);
    return this.load(registrationId);
  }

  /**
   * Substitution after lock (§4): only for APPROVED registrations and before the team's first
   * match is COMPLETED; the incoming player must be fully eligible (incl. current membership).
   * Creates a new LOCKED version (old → SUPERSEDED) with `change_reason`.
   */
  async substitute(
    actorUserId: string,
    tournamentId: string,
    registrationId: string,
    dto: SubstituteRegistrationDto,
    ctx: AuditRequestContext,
  ): Promise<AdminRegistrationDto> {
    await this.prisma.client.$transaction(async (tx) => {
      const t = await lockTournament(tx, tournamentId, 'update');
      const reg = await lockRegistration(tx, tournamentId, registrationId);
      await lockTeam(tx, reg.teamId);
      await requireTournamentAdmin(tx, actorUserId, t);
      if (!SUBSTITUTION_TOURNAMENT_STATUSES.has(t.status)) {
        throw substitutionNotAllowed(`Substitutions are not possible while ${t.status}`);
      }
      if (reg.status !== 'APPROVED') {
        throw substitutionNotAllowed('Only approved (locked) registrations take substitutions');
      }
      const played = await tx.match.count({
        where: {
          tournamentId,
          status: 'COMPLETED',
          OR: [{ teamAId: reg.teamId }, { teamBId: reg.teamId }],
        },
      });
      if (played > 0) {
        throw substitutionNotAllowed("The team's first match is already completed");
      }
      const roster = await currentRoster(tx, registrationId);
      if (!roster || roster.status !== 'LOCKED') {
        throw new Error(`registration ${registrationId} has no LOCKED roster`);
      }
      const out = roster.entries.find((e) => e.userId === dto.outUserId);
      if (!out) {
        throw rosterInvalid([
          { field: 'outUserId', message: 'player is not on the locked roster' },
        ]);
      }
      if (roster.entries.some((e) => e.userId === dto.inUserId)) {
        throw rosterInvalid([{ field: 'inUserId', message: 'player is already on the roster' }]);
      }
      const kept = roster.entries.filter((e) => e.userId !== dto.outUserId);
      const starters = [
        ...kept.filter((e) => e.role === 'STARTER').map((e) => e.userId),
        ...(dto.role === 'STARTER' ? [dto.inUserId] : []),
      ];
      const substitutes = [
        ...kept.filter((e) => e.role === 'SUBSTITUTE').map((e) => e.userId),
        ...(dto.role === 'SUBSTITUTE' ? [dto.inUserId] : []),
      ];
      const shape = rosterShapeProblems(starters, substitutes);
      if (shape.length > 0) {
        throw rosterInvalid([
          { field: 'role', message: 'the substitution must keep 5 starters and ≤ 2 substitutes' },
          ...shape,
        ]);
      }
      const { snapshots, problems } = await evaluateEligibility(tx, {
        tournamentId,
        teamId: reg.teamId,
        userIds: [dto.inUserId],
        checkMembership: true,
      });
      if (problems.length > 0) throw playerIneligible(problems);
      const incoming = snapshots.get(dto.inUserId)!;
      const entries: RosterEntryInput[] = [
        ...kept,
        {
          userId: incoming.userId,
          steamId64: incoming.steamId64,
          nickname: incoming.nickname,
          role: dto.role,
        },
      ];
      const now = new Date();
      const next = await writeRosterVersion(tx, {
        registrationId,
        previous: roster,
        status: 'LOCKED',
        lockedById: actorUserId,
        changeReason: dto.reason,
        entries,
        now,
      });
      await this.audit.write(
        {
          action: 'registration.substitute',
          actorUserId,
          resourceType: 'tournament_registration',
          resourceId: registrationId,
          detail: {
            tournamentId,
            teamId: reg.teamId,
            outUserId: dto.outUserId,
            outRole: out.role,
            inUserId: dto.inUserId,
            role: dto.role,
            reason: dto.reason,
            previousRosterId: roster.id,
            rosterId: next.id,
            rosterVersion: next.version,
          },
        },
        ctx,
        tx,
      );
    }, M3_TX_OPTIONS);
    return this.load(registrationId);
  }

  /** Sample teams are never mutated; approval additionally needs an ACTIVE team. */
  private async assertTeamUsable(
    tx: Tx,
    teamId: string,
    options: { requireActive: boolean } = { requireActive: true },
  ): Promise<void> {
    const team = await tx.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { isSample: true, status: true },
    });
    if (team.isSample) throw sampleResource();
    if (options.requireActive && team.status !== 'ACTIVE') {
      throw conflict(API_ERROR_CODES.teamNotActive, 'Team is not active');
    }
  }

  private async load(registrationId: string): Promise<AdminRegistrationDto> {
    const row = await this.prisma.client.tournamentRegistration.findUniqueOrThrow({
      where: { id: registrationId },
      select: registrationSelect,
    });
    return toAdminRegistrationDto(row);
  }
}

import { Injectable } from '@nestjs/common';
import { DB_CONSTRAINTS, type Prisma } from '@rage/db';
import { type AuditRequestContext, AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { assertTeamActive, lockTeam, requireOperator } from '../team-domain/team-access.js';
import { fieldError, rethrowMapped } from '../team-domain/team-errors.js';
import { SamplePolicy, sampleAuditTag } from '../tournament-domain/sample-policy.js';
import { assertNoSharedOperator } from '../tournament-domain/conflict-of-interest.js';
import { entriesFromSelection, evaluateEligibility } from '../tournament-domain/eligibility.js';
import { registrationSelect, toRegistrationDto } from '../tournament-domain/registration-view.js';
import {
  currentRoster,
  lockRegistration,
  writeRosterVersion,
} from '../tournament-domain/rosters.js';
import {
  type LockedTournament,
  lockTournament,
  M3_TX_OPTIONS,
} from '../tournament-domain/tournament-access.js';
import {
  alreadyRegistered,
  invalidStateTransition,
  playerIneligible,
  registrationClosed,
  registrationNotPending,
  rosterInvalid,
  tournamentNotFound,
} from '../tournament-domain/tournament-errors.js';
import {
  isRegistrationWindowOpen,
  MY_REGISTRATIONS_LIMIT,
  rosterShapeProblems,
} from '../tournament-domain/tournament-policy.js';
import type { CreateRegistrationDto, RegistrationDto } from './registrations.dto.js';

type Tx = Prisma.TransactionClient;

/** Statuses in which a team may still withdraw (§4: not once the tournament is running). */
const WITHDRAW_BLOCKED = new Set(['IN_PROGRESS', 'COMPLETED']);

/**
 * Team-operator side of registrations (docs/TOURNAMENTS.md §4). Lock order: tournament
 * (FOR UPDATE) → registration → team → grants → user rows.
 */
@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly samples: SamplePolicy,
  ) {}

  /** Tournament lock for operator actions: DRAFT tournaments are unpublished → 404. */
  private async lockPublishedTournament(tx: Tx, tournamentId: string): Promise<LockedTournament> {
    const t = await lockTournament(tx, tournamentId, 'update', this.samples);
    if (t.status === 'DRAFT') throw tournamentNotFound();
    return t;
  }

  async register(
    actorUserId: string,
    tournamentId: string,
    dto: CreateRegistrationDto,
    ctx: AuditRequestContext,
  ): Promise<RegistrationDto> {
    const shape = rosterShapeProblems(dto.starters, dto.substitutes);
    if (shape.length > 0) throw rosterInvalid(shape);
    try {
      const id = await this.prisma.client.$transaction(async (tx) => {
        const tournament = await this.lockPublishedTournament(tx, tournamentId);
        const team = await lockTeam(tx, dto.teamId, { allowSample: true });
        this.samples.assertTeamAllowedIn(team, tournament);
        const access = await requireOperator(tx, dto.teamId, actorUserId);
        assertTeamActive(team);
        const now = new Date();
        if (!isRegistrationWindowOpen(tournament, now)) throw registrationClosed();
        const existing = await tx.tournamentRegistration.findUnique({
          where: { tournamentId_teamId: { tournamentId, teamId: dto.teamId } },
          select: { id: true },
        });
        if (existing) throw alreadyRegistered();
        await assertNoSharedOperator(tx, tournamentId, dto.teamId);
        const { snapshots, problems } = await evaluateEligibility(tx, {
          tournamentId,
          teamId: dto.teamId,
          userIds: [...dto.starters, ...dto.substitutes],
          checkMembership: true,
          allowSamplePlayers: this.samples.samplePlayersAllowed(tournament),
        });
        if (problems.length > 0) throw playerIneligible(problems);
        const registration = await tx.tournamentRegistration.create({
          data: {
            tournamentId,
            teamId: dto.teamId,
            requestedById: actorUserId,
            status: 'PENDING',
            createdAt: now,
          },
          select: { id: true },
        });
        const roster = await writeRosterVersion(tx, {
          registrationId: registration.id,
          previous: null,
          status: 'DRAFT',
          entries: entriesFromSelection(dto.starters, dto.substitutes, snapshots),
          now,
        });
        await this.audit.write(
          {
            action: 'registration.submit',
            actorUserId,
            resourceType: 'tournament_registration',
            resourceId: registration.id,
            detail: {
              tournamentId,
              teamId: dto.teamId,
              rosterId: roster.id,
              rosterVersion: roster.version,
              starters: dto.starters,
              substitutes: dto.substitutes,
              ...(access.override ? { override: true } : {}),
              ...sampleAuditTag(tournament.isSample),
            },
          },
          ctx,
          tx,
        );
        return registration.id;
      }, M3_TX_OPTIONS);
      return await this.load(id);
    } catch (err) {
      rethrowMapped(err, {
        [DB_CONSTRAINTS.registrationTournamentTeamUnique]: alreadyRegistered,
      });
    }
  }

  async updateRoster(
    actorUserId: string,
    tournamentId: string,
    registrationId: string,
    dto: CreateRegistrationDto,
    ctx: AuditRequestContext,
  ): Promise<RegistrationDto> {
    const shape = rosterShapeProblems(dto.starters, dto.substitutes);
    if (shape.length > 0) throw rosterInvalid(shape);
    await this.prisma.client.$transaction(async (tx) => {
      const tournament = await this.lockPublishedTournament(tx, tournamentId);
      const registration = await lockRegistration(tx, tournamentId, registrationId);
      if (registration.teamId !== dto.teamId) {
        throw fieldError('teamId', 'teamId does not match the registration');
      }
      const team = await lockTeam(tx, registration.teamId, { allowSample: true });
      this.samples.assertTeamAllowedIn(team, tournament);
      const access = await requireOperator(tx, registration.teamId, actorUserId);
      if (registration.status !== 'PENDING') throw registrationNotPending();
      const now = new Date();
      if (!isRegistrationWindowOpen(tournament, now)) throw registrationClosed();
      const previous = await currentRoster(tx, registrationId);
      if (!previous || previous.status !== 'DRAFT') throw registrationNotPending();
      const { snapshots, problems } = await evaluateEligibility(tx, {
        tournamentId,
        teamId: registration.teamId,
        userIds: [...dto.starters, ...dto.substitutes],
        checkMembership: true,
        allowSamplePlayers: this.samples.samplePlayersAllowed(tournament),
      });
      if (problems.length > 0) throw playerIneligible(problems);
      const roster = await writeRosterVersion(tx, {
        registrationId,
        previous,
        status: 'DRAFT',
        entries: entriesFromSelection(dto.starters, dto.substitutes, snapshots),
        now,
      });
      await this.audit.write(
        {
          action: 'registration.roster_update',
          actorUserId,
          resourceType: 'tournament_registration',
          resourceId: registrationId,
          detail: {
            tournamentId,
            teamId: registration.teamId,
            rosterId: roster.id,
            rosterVersion: roster.version,
            previousRosterId: previous.id,
            starters: dto.starters,
            substitutes: dto.substitutes,
            ...(access.override ? { override: true } : {}),
            ...sampleAuditTag(tournament.isSample),
          },
        },
        ctx,
        tx,
      );
    }, M3_TX_OPTIONS);
    return this.load(registrationId);
  }

  async withdraw(
    actorUserId: string,
    tournamentId: string,
    registrationId: string,
    ctx: AuditRequestContext,
  ): Promise<RegistrationDto> {
    await this.prisma.client.$transaction(async (tx) => {
      const tournament = await this.lockPublishedTournament(tx, tournamentId);
      const registration = await lockRegistration(tx, tournamentId, registrationId);
      const team = await lockTeam(tx, registration.teamId, { allowSample: true });
      this.samples.assertTeamAllowedIn(team, tournament);
      const access = await requireOperator(tx, registration.teamId, actorUserId);
      if (registration.status !== 'PENDING' && registration.status !== 'APPROVED') {
        throw registrationNotPending();
      }
      if (WITHDRAW_BLOCKED.has(tournament.status)) {
        throw invalidStateTransition('Cannot withdraw once the tournament is in progress');
      }
      await tx.tournamentRegistration.update({
        where: { id: registrationId },
        data: { status: 'WITHDRAWN' },
      });
      await this.audit.write(
        {
          action: 'registration.withdraw',
          actorUserId,
          resourceType: 'tournament_registration',
          resourceId: registrationId,
          detail: {
            tournamentId,
            teamId: registration.teamId,
            previousStatus: registration.status,
            ...(access.override ? { override: true } : {}),
            ...sampleAuditTag(tournament.isSample),
          },
        },
        ctx,
        tx,
      );
    }, M3_TX_OPTIONS);
    return this.load(registrationId);
  }

  /** Registrations of teams the user operates as captain or TEAM_MANAGER (newest first). */
  async listMine(userId: string): Promise<RegistrationDto[]> {
    const db = this.prisma.client;
    const [captaincies, grants] = await Promise.all([
      db.teamMembership.findMany({
        where: { userId, role: 'CAPTAIN', leftAt: null },
        select: { teamId: true },
      }),
      db.userRoleGrant.findMany({
        where: { userId, role: 'TEAM_MANAGER', scopeType: 'TEAM', revokedAt: null },
        select: { scopeId: true },
      }),
    ]);
    const teamIds = [
      ...new Set([
        ...captaincies.map((c) => c.teamId),
        ...grants.map((g) => g.scopeId).filter((x): x is string => x !== null),
      ]),
    ];
    if (teamIds.length === 0) return [];
    const rows = await db.tournamentRegistration.findMany({
      where: { teamId: { in: teamIds } },
      select: registrationSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MY_REGISTRATIONS_LIMIT,
    });
    return rows.map(toRegistrationDto);
  }

  private async load(registrationId: string): Promise<RegistrationDto> {
    const row = await this.prisma.client.tournamentRegistration.findUniqueOrThrow({
      where: { id: registrationId },
      select: registrationSelect,
    });
    return toRegistrationDto(row);
  }
}

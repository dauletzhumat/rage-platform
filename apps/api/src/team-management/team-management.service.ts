import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DB_CONSTRAINTS } from '@rage/db';
import { type AuditRequestContext, AuditService } from '../audit/audit.service.js';
import { API_ERROR_CODES } from '../common/errors/api-error.js';
import { errorSummary, PrismaService } from '../infra/prisma/prisma.service.js';
import {
  assertTeamActive,
  lockTeam,
  requireOperator,
  resolveTeamAccess,
  TX_OPTIONS,
} from '../team-domain/team-access.js';
import {
  captainMustTransfer,
  conflict,
  fieldError,
  forbiddenRole,
  invitationExpired,
  invitationNotPending,
  notFoundWithCode,
  notTeamMember,
  rethrowMapped,
} from '../team-domain/team-errors.js';
import {
  expireStaleInvitations,
  teamInvitationSelect,
  toTeamInvitationView,
} from '../team-domain/invitations.js';
import {
  INVITATION_TTL_MS,
  MAX_PENDING_INVITATIONS_PER_TEAM,
  ROSTER_CAP,
  INVITATION_COOLDOWN_MS,
} from '../team-domain/team-policy.js';
import type { TeamDetailDto } from '../teams/teams.dto.js';
import { TeamsService } from '../teams/teams.service.js';
import type {
  CreateInvitationDto,
  TeamInvitationDto,
  TeamManageDto,
} from './team-management.dto.js';

const invitationAlreadyPending = () =>
  conflict(
    API_ERROR_CODES.invitationAlreadyPending,
    'This player already has a pending invitation to this team',
  );
const playerNotFound = () =>
  notFoundWithCode(
    API_ERROR_CODES.playerNotFound,
    'No registered player with this SteamID64 (players must sign in once before being invited)',
  );

@Injectable()
export class TeamManagementService {
  private readonly logger = new Logger(TeamManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly teams: TeamsService,
  ) {}

  /** Operator view (TEAMS.md §4.2). Non-operators get 403 FORBIDDEN_ROLE; the team is public. */
  async manage(
    slug: string,
    actorUserId: string,
    ctx: AuditRequestContext,
  ): Promise<TeamManageDto> {
    const team = await this.prisma.client.team.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!team) throw new NotFoundException('Team not found');
    const access = await this.prisma.client.$transaction(
      (tx) => resolveTeamAccess(tx, team.id, actorUserId),
      TX_OPTIONS,
    );
    if (!access.isOperator) throw forbiddenRole();
    // Lazy expiry on read is best effort (TEAMS.md §6.4): a failure must not break the view.
    try {
      await this.prisma.client.$transaction(
        (tx) => expireStaleInvitations(tx, this.audit, ctx, { teamId: team.id }, actorUserId),
        TX_OPTIONS,
      );
    } catch (err) {
      this.logger.warn({ err: errorSummary(err) }, 'lazy invitation expiry failed');
    }
    const [detail, invitations] = await Promise.all([
      this.teams.getDetailById(team.id),
      this.prisma.client.teamInvitation.findMany({
        where: { teamId: team.id, status: 'PENDING', expiresAt: { gt: new Date() } },
        select: teamInvitationSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    return {
      team: detail,
      pendingInvitations: invitations.map(toTeamInvitationView),
      permissions: {
        canInvite: true,
        canRemove: true,
        canTransfer: access.isCaptain || access.isSuperAdmin,
      },
      rosterCap: ROSTER_CAP,
      pendingInvitationCap: MAX_PENDING_INVITATIONS_PER_TEAM,
    };
  }

  async invite(
    actorUserId: string,
    teamId: string,
    dto: CreateInvitationDto,
    ctx: AuditRequestContext,
  ): Promise<TeamInvitationDto> {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const team = await lockTeam(tx, teamId);
        const access = await requireOperator(tx, teamId, actorUserId);
        assertTeamActive(team);
        // Players must have signed in once; no placeholder users are ever created (TEAMS.md §5).
        const invitee = await tx.user.findUnique({
          where: { steamId64: dto.steamId64 },
          select: { id: true, status: true, isSample: true },
        });
        if (!invitee || invitee.status !== 'ACTIVE' || invitee.isSample) throw playerNotFound();
        const member = await tx.teamMembership.findFirst({
          where: { teamId, userId: invitee.id, leftAt: null },
          select: { id: true },
        });
        if (member) {
          throw conflict(API_ERROR_CODES.alreadyMember, 'Player is already on this team');
        }
        if (invitee.id === actorUserId) {
          throw fieldError('steamId64', 'You cannot invite yourself');
        }
        const now = new Date();
        await expireStaleInvitations(tx, this.audit, ctx, { teamId }, actorUserId, now);
        const pendingForInvitee = await tx.teamInvitation.findFirst({
          where: { teamId, inviteeUserId: invitee.id, status: 'PENDING' },
          select: { id: true },
        });
        if (pendingForInvitee) throw invitationAlreadyPending();
        // Anti-harassment (gate L-5): no re-invite within 24 h of a revoke/decline.
        const recentlyClosed = await tx.teamInvitation.findFirst({
          where: {
            teamId,
            inviteeUserId: invitee.id,
            status: { in: ['REVOKED', 'DECLINED'] },
            respondedAt: { gt: new Date(now.getTime() - INVITATION_COOLDOWN_MS) },
          },
          select: { id: true },
        });
        if (recentlyClosed) {
          throw conflict(
            API_ERROR_CODES.invitationCooldown,
            'This player was invited recently; wait 24 hours after a revoke or decline',
          );
        }
        const pendingCount = await tx.teamInvitation.count({
          where: { teamId, status: 'PENDING' },
        });
        if (pendingCount >= MAX_PENDING_INVITATIONS_PER_TEAM) {
          throw conflict(
            API_ERROR_CODES.invitationLimit,
            `A team can have at most ${MAX_PENDING_INVITATIONS_PER_TEAM} pending invitations`,
          );
        }
        const row = await tx.teamInvitation.create({
          data: {
            teamId,
            inviteeUserId: invitee.id,
            invitedById: actorUserId,
            role: dto.role,
            status: 'PENDING',
            createdAt: now,
            expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
          },
          select: teamInvitationSelect,
        });
        await this.audit.write(
          {
            action: 'team_invitation.create',
            actorUserId,
            resourceType: 'team_invitation',
            resourceId: row.id,
            detail: {
              teamId,
              inviteeUserId: invitee.id,
              role: dto.role,
              ...(access.override ? { override: true } : {}),
            },
          },
          ctx,
          tx,
        );
        return toTeamInvitationView(row);
      }, TX_OPTIONS);
    } catch (err) {
      rethrowMapped(err, {
        [DB_CONSTRAINTS.invitationOnePendingPerTeamInvitee]: invitationAlreadyPending,
      });
    }
  }

  async revoke(
    actorUserId: string,
    teamId: string,
    invitationId: string,
    reason: string | null | undefined,
    ctx: AuditRequestContext,
  ): Promise<TeamInvitationDto> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      await lockTeam(tx, teamId);
      const access = await requireOperator(tx, teamId, actorUserId);
      const locked = await tx.$queryRaw<{ status: string; expires_at: Date }[]>`
        SELECT status, expires_at FROM team_invitations
        WHERE id = ${invitationId}::uuid AND team_id = ${teamId}::uuid
        FOR UPDATE`;
      const inv = locked[0];
      if (!inv) throw new NotFoundException('Invitation not found');
      if (inv.status !== 'PENDING') throw invitationNotPending();
      const now = new Date();
      if (inv.expires_at.getTime() <= now.getTime()) {
        await expireStaleInvitations(tx, this.audit, ctx, { invitationId }, actorUserId, now);
        return { expired: true as const };
      }
      const row = await tx.teamInvitation.update({
        where: { id: invitationId },
        data: { status: 'REVOKED', respondedAt: now },
        select: teamInvitationSelect,
      });
      await this.audit.write(
        {
          action: 'team_invitation.revoke',
          actorUserId,
          resourceType: 'team_invitation',
          resourceId: invitationId,
          detail: {
            teamId,
            inviteeUserId: row.inviteeUserId,
            reason: reason ?? null,
            ...(access.override ? { override: true } : {}),
          },
        },
        ctx,
        tx,
      );
      return { expired: false as const, view: toTeamInvitationView(row) };
    }, TX_OPTIONS);
    // The EXPIRED transition is committed before answering (TEAMS.md §6.4).
    if (result.expired) throw invitationExpired();
    return result.view;
  }

  async removeMember(
    actorUserId: string,
    teamId: string,
    userId: string,
    reason: string,
    ctx: AuditRequestContext,
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await lockTeam(tx, teamId);
      // Operator status re-checked under the team lock (TEAMS.md §6.2).
      const access = await requireOperator(tx, teamId, actorUserId);
      const membership = await tx.teamMembership.findFirst({
        where: { teamId, userId, leftAt: null },
        select: { id: true, role: true },
      });
      if (!membership) throw notTeamMember();
      // Nobody removes the captain — not even a TEAM_MANAGER or SUPER_ADMIN; transfer first.
      if (membership.role === 'CAPTAIN') throw captainMustTransfer();
      await tx.teamMembership.update({
        where: { id: membership.id },
        data: { leftAt: new Date(), leftReason: 'removed' },
      });
      await this.audit.write(
        {
          action: 'team_membership.remove',
          actorUserId,
          resourceType: 'team_membership',
          resourceId: membership.id,
          detail: {
            teamId,
            userId,
            role: membership.role,
            reason,
            actingAs: access.isCaptain ? 'captain' : access.isManager ? 'manager' : 'super_admin',
            ...(access.override ? { override: true } : {}),
          },
        },
        ctx,
        tx,
      );
    }, TX_OPTIONS);
  }

  async leave(actorUserId: string, teamId: string, ctx: AuditRequestContext): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await lockTeam(tx, teamId);
      const membership = await tx.teamMembership.findFirst({
        where: { teamId, userId: actorUserId, leftAt: null },
        select: { id: true, role: true },
      });
      if (!membership) throw notTeamMember();
      if (membership.role === 'CAPTAIN') throw captainMustTransfer();
      await tx.teamMembership.update({
        where: { id: membership.id },
        data: { leftAt: new Date(), leftReason: 'left' },
      });
      await this.audit.write(
        {
          action: 'team_membership.leave',
          actorUserId,
          resourceType: 'team_membership',
          resourceId: membership.id,
          detail: { teamId, userId: actorUserId, role: membership.role },
        },
        ctx,
        tx,
      );
    }, TX_OPTIONS);
  }

  /**
   * TEAMS.md §6.2: closes the captain row and the target row (`captain_transfer`) and opens a
   * CAPTAIN row for the target plus a PLAYER row for the old captain, both with the same
   * `joined_at`. History is never rewritten.
   */
  async transferCaptain(
    actorUserId: string,
    teamId: string,
    newCaptainUserId: string,
    ctx: AuditRequestContext,
  ): Promise<TeamDetailDto> {
    await this.prisma.client.$transaction(async (tx) => {
      await lockTeam(tx, teamId);
      const access = await resolveTeamAccess(tx, teamId, actorUserId);
      // TEAM_MANAGER cannot transfer captaincy.
      if (!access.isCaptain && !access.isSuperAdmin) throw forbiddenRole();
      const captainRow = await tx.teamMembership.findFirst({
        where: { teamId, role: 'CAPTAIN', leftAt: null },
        select: { id: true, userId: true },
      });
      if (captainRow?.userId === newCaptainUserId) {
        throw fieldError('newCaptainUserId', 'This user is already the captain');
      }
      const target = await tx.teamMembership.findFirst({
        where: { teamId, userId: newCaptainUserId, leftAt: null },
        select: { id: true, role: true },
      });
      if (!target) throw notTeamMember();
      // Gate L-6: the new captain must be an ACTIVE account. FOR SHARE conflicts with a
      // concurrent suspension (UPDATE users), so the check holds at commit time.
      const targetUser = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM users WHERE id = ${newCaptainUserId}::uuid FOR SHARE`;
      if (targetUser[0]?.status !== 'ACTIVE') {
        throw conflict(
          API_ERROR_CODES.memberIneligible,
          'The new captain must be an active account',
        );
      }
      const now = new Date();
      const toClose = [target.id, ...(captainRow ? [captainRow.id] : [])];
      const closed = await tx.teamMembership.updateMany({
        where: { id: { in: toClose }, leftAt: null },
        data: { leftAt: now, leftReason: 'captain_transfer' },
      });
      if (closed.count !== toClose.length) throw new Error('membership rows changed under lock');
      await tx.teamMembership.create({
        data: { teamId, userId: newCaptainUserId, role: 'CAPTAIN', joinedAt: now },
      });
      if (captainRow) {
        await tx.teamMembership.create({
          data: { teamId, userId: captainRow.userId, role: 'PLAYER', joinedAt: now },
        });
      }
      await this.audit.write(
        {
          action: 'team.captain_transfer',
          actorUserId,
          resourceType: 'team',
          resourceId: teamId,
          detail: {
            fromUserId: captainRow?.userId ?? null,
            toUserId: newCaptainUserId,
            previousRole: target.role,
            ...(access.isSuperAdmin && !access.isCaptain ? { override: true } : {}),
          },
        },
        ctx,
        tx,
      );
    }, TX_OPTIONS);
    return this.teams.getDetailById(teamId);
  }
}
